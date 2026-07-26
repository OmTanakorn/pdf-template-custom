import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConflictError, NotFoundError, TemplateStore } from '../src/templates.ts';

const template = {
  version: 1,
  name: 'ใบกำกับภาษี',
  page: { preset: 'A4', orientation: 'portrait', margin: { top: 10, right: 10, bottom: 10, left: 10 } },
  header: { height: 20, items: [] },
  footer: { height: 10, items: [] },
  overlay: [],
  body: [],
};

async function store() {
  return new TemplateStore(await mkdtemp(join(tmpdir(), 'pdftc-templates-')));
}

test('a saved template comes back with its data', async () => {
  const s = await store();
  const created = await s.create({ template, data: { total: 42 } });

  const loaded = await s.get(created.id);
  assert.equal(loaded.name, 'ใบกำกับภาษี');
  assert.equal(loaded.rev, 1);
  assert.deepEqual(loaded.data, { total: 42 });
  assert.equal(loaded.template.page.preset, 'A4');
});

test('a name with no latin characters still yields a usable id', async () => {
  const s = await store();
  const created = await s.create({ template, data: {} });
  assert.match(created.id, /^[a-z0-9][a-z0-9-]*$/);
});

test('saving bumps the rev and the stale copy is refused', async () => {
  const s = await store();
  const created = await s.create({ template, data: {} });

  const saved = await s.update(created.id, { rev: created.rev, data: { total: 1 } });
  assert.equal(saved.rev, 2);

  // Someone else saved first; this copy predates that save.
  await assert.rejects(() => s.update(created.id, { rev: created.rev, data: { total: 2 } }), ConflictError);

  const loaded = await s.get(created.id);
  assert.deepEqual(loaded.data, { total: 1 });
});

test('renaming renames the template the PDF is printed under', async () => {
  const s = await store();
  const created = await s.create({ template, data: {} });

  const renamed = await s.update(created.id, { rev: created.rev, name: 'ใบเสร็จรับเงิน' });
  assert.equal(renamed.name, 'ใบเสร็จรับเงิน');
  assert.equal(renamed.template.name, 'ใบเสร็จรับเงิน');
});

test('a malformed template is rejected on save, not on read', async () => {
  const s = await store();
  await assert.rejects(() => s.create({ template: { ...template, page: { preset: 'A3' } }, data: {} }));
  assert.deepEqual(await s.list(), []);

  const created = await s.create({ template, data: {} });
  await assert.rejects(() => s.update(created.id, { rev: created.rev, template: { ...template, body: 'not a list' } }));
  assert.equal((await s.get(created.id)).rev, 1);
});

test('duplicate copies the document without sharing the id', async () => {
  const s = await store();
  const created = await s.create({ template, data: { total: 7 } });

  const copy = await s.duplicate(created.id);
  assert.notEqual(copy.id, created.id);
  assert.equal(copy.rev, 1);
  assert.deepEqual(copy.data, { total: 7 });
  assert.equal((await s.list()).length, 2);
});

test('list is newest save first and carries no payload', async () => {
  const s = await store();
  const first = await s.create({ name: 'ก', template, data: {} });
  await s.create({ name: 'ข', template, data: {} });
  await s.update(first.id, { rev: first.rev, data: { touched: true } });

  const list = await s.list();
  assert.deepEqual(
    list.map((row) => row.name),
    ['ก', 'ข'],
  );
  assert.equal('template' in list[0]!, false);
  assert.equal('data' in list[0]!, false);
});

test('an id that escapes the store directory is not found', async () => {
  const s = await store();
  for (const id of ['../../etc/passwd', 'a/b', '.', '']) {
    await assert.rejects(() => s.get(id), NotFoundError);
  }
});

test('a file that is not a valid record is skipped instead of breaking the list', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pdftc-templates-'));
  const s = new TemplateStore(dir);
  const good = await s.create({ template, data: {} });
  await writeFile(join(dir, 'broken.json'), '{ not json', 'utf8');

  const list = await s.list();
  assert.deepEqual(
    list.map((row) => row.id),
    [good.id],
  );
});

test('delete removes the file and then reports the id as gone', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pdftc-templates-'));
  const s = new TemplateStore(dir);
  const created = await s.create({ template, data: {} });

  await s.remove(created.id);
  assert.deepEqual(await readdir(dir), []);
  await assert.rejects(() => s.get(created.id), NotFoundError);
  await assert.rejects(() => s.remove(created.id), NotFoundError);
});

test('listing a store that was never written to is empty, not an error', async () => {
  const s = new TemplateStore(join(tmpdir(), `pdftc-missing-${Date.now()}`));
  assert.deepEqual(await s.list(), []);
  assert.equal(await s.count(), 0);
});
