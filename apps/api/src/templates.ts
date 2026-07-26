/**
 * Template library on disk.
 *
 * The studio is a design tool for a team, so a template has to outlive the tab
 * it was drawn in. One JSON file per template under `TEMPLATE_DIR` is the whole
 * store: it diffs in git, it is readable without the app, and a template can be
 * dropped in by hand. A database buys indexing and transactions that a library
 * of a few hundred documents does not need.
 *
 * Two people can have the same template open. Every save carries the `rev` it
 * was loaded at; a stale one is refused rather than silently overwriting work
 * that landed in between (`ConflictError` → 409). Writes go to a temp file and
 * are renamed into place, so a crash mid-write cannot leave a half-written
 * template behind — the reader either sees the old file or the new one.
 */
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseTemplate, type Template } from '@pdftc/schema';

export interface TemplateRecord {
  id: string;
  name: string;
  /** Bumped on every save. A client must send back the rev it loaded. */
  rev: number;
  createdAt: number;
  updatedAt: number;
  template: Template;
  /** Sample data the template is designed against; the studio edits both. */
  data: unknown;
}

/** A row of the library list — everything but the two heavy payloads. */
export type TemplateSummary = Omit<TemplateRecord, 'template' | 'data'>;

export class NotFoundError extends Error {}

export class ConflictError extends Error {
  constructor(readonly current: number) {
    super(`template changed since it was loaded (current rev ${current})`);
  }
}

/**
 * Ids reach the filesystem as a path segment, so they are generated here and
 * validated on the way back in. Anything outside this alphabet — a slash, a
 * dot, a NUL — is rejected before it can be joined onto the store directory.
 */
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

export class TemplateStore {
  private readonly dir: string;

  constructor(dir: string) {
    this.dir = resolve(dir);
  }

  async list(): Promise<TemplateSummary[]> {
    const files = await this.files();
    const records = await Promise.all(files.map((file) => this.readFileRecord(file).catch(() => null)));
    return records
      .filter((record): record is TemplateRecord => record !== null)
      .map(summarize)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async get(id: string): Promise<TemplateRecord> {
    const record = await this.readFileRecord(this.pathOf(id));
    // A file renamed by hand would otherwise answer to two different ids.
    if (record.id !== id) throw new NotFoundError(`template ${id} not found`);
    return record;
  }

  async create(input: { name?: string; template: unknown; data?: unknown }): Promise<TemplateRecord> {
    const template = parseTemplate(input.template);
    const name = (input.name ?? template.name ?? '').trim() || 'เอกสารใหม่';
    const now = Date.now();
    const record: TemplateRecord = {
      id: await this.freshId(name),
      name,
      rev: 1,
      createdAt: now,
      updatedAt: now,
      template: { ...template, name },
      data: input.data ?? {},
    };
    await this.write(record);
    return record;
  }

  /**
   * Partial save: the studio sends the name alone when renaming and the whole
   * document when saving. `rev` is required — a caller that cannot say what it
   * was editing cannot be checked for staleness.
   */
  async update(id: string, patch: { rev: number; name?: string; template?: unknown; data?: unknown }): Promise<TemplateRecord> {
    const current = await this.get(id);
    if (patch.rev !== current.rev) throw new ConflictError(current.rev);

    const template = patch.template === undefined ? current.template : parseTemplate(patch.template);
    const name = (patch.name ?? template.name ?? current.name).trim() || current.name;
    const next: TemplateRecord = {
      ...current,
      name,
      rev: current.rev + 1,
      updatedAt: Date.now(),
      // The name shown in the library and the one baked into the PDF are the
      // same name; keeping them apart only creates a way for them to disagree.
      template: { ...template, name },
      data: patch.data === undefined ? current.data : patch.data,
    };
    await this.write(next);
    return next;
  }

  async duplicate(id: string, name?: string): Promise<TemplateRecord> {
    const source = await this.get(id);
    return this.create({ name: (name ?? `${source.name} (สำเนา)`).trim(), template: source.template, data: source.data });
  }

  async remove(id: string): Promise<void> {
    try {
      await unlink(this.pathOf(id));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new NotFoundError(`template ${id} not found`);
      throw err;
    }
  }

  async count(): Promise<number> {
    return (await this.files()).length;
  }

  private pathOf(id: string): string {
    if (!ID.test(id)) throw new NotFoundError(`template ${id} not found`);
    return join(this.dir, `${id}.json`);
  }

  private async files(): Promise<string[]> {
    try {
      const entries = await readdir(this.dir);
      return entries.filter((name) => name.endsWith('.json')).map((name) => join(this.dir, name));
    } catch (err) {
      // An empty library and a library that has never been saved to look the same.
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
  }

  private async readFileRecord(path: string): Promise<TemplateRecord> {
    let raw: string;
    try {
      raw = await readFile(path, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new NotFoundError('template not found');
      throw err;
    }
    const parsed = JSON.parse(raw) as TemplateRecord;
    // Templates on disk can predate a schema change, so they are parsed on the
    // way out too — a bad one fails its own read instead of the whole listing.
    return { ...parsed, template: parseTemplate(parsed.template), data: parsed.data ?? {} };
  }

  private async write(record: TemplateRecord): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const path = this.pathOf(record.id);
    const tmp = `${path}.${randomBytes(6).toString('hex')}.tmp`;
    await writeFile(tmp, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    await rename(tmp, path);
  }

  /** `ใบกำกับภาษี` slugs to nothing, so every id ends in random characters anyway. */
  private async freshId(name: string): Promise<string> {
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
    const taken = new Set((await this.files()).map((file) => file.replace(/^.*\//, '').replace(/\.json$/, '')));
    for (let attempt = 0; attempt < 8; attempt++) {
      const id = `${slug ? `${slug}-` : 'doc-'}${randomBytes(4).toString('hex')}`;
      if (!taken.has(id)) return id;
    }
    throw new Error('could not allocate a template id');
  }
}

function summarize(record: TemplateRecord): TemplateSummary {
  const { template: _template, data: _data, ...rest } = record;
  return rest;
}
