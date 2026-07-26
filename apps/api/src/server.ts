/**
 * Render service. Holds one Chromium open for the process lifetime, so a
 * render costs ~150ms instead of ~450ms.
 *
 * Every render passes the same three layers, cheapest first:
 *
 *   cache (`cache.ts`)  → identical bytes rendered moments ago
 *   gate  (`gate.ts`)   → dedupe in-flight work, then bound concurrency
 *   renderer            → Chromium
 *
 * POST   /api/render          { template, data }  → application/pdf
 * POST   /api/render?async=1  { template, data }  → 202 + job id
 * POST   /api/html            { template, data }  → text/html (the intermediate document)
 * GET    /api/jobs/:id                            → job status
 * GET    /api/jobs/:id/result                     → application/pdf once done
 * GET    /api/example                             → the bundled invoice template + data
 * GET    /api/health                              → gate, cache and job counters
 *
 * The template library (`templates.ts`) is stored per file on disk:
 *
 * GET    /api/templates                           → summaries, newest save first
 * POST   /api/templates       { name, template, data }
 * GET    /api/templates/:id                       → the full record
 * PUT    /api/templates/:id   { rev, name?, template?, data? }  → 409 if stale
 * POST   /api/templates/:id/duplicate  { name? }
 * DELETE /api/templates/:id
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { availableParallelism } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTemplate, type Template } from '@pdftc/schema';
import { PdfRenderer } from '@pdftc/pdf';
import { OverloadError, RenderGate } from './gate.js';
import { ResultCache } from './cache.js';
import { JobStore, type Job } from './jobs.js';
import { ConflictError, NotFoundError, TemplateStore } from './templates.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const PORT = Number(process.env.PORT ?? 8787);
const MAX_BODY = 8 * 1024 * 1024;

// Chromium contexts are memory-bound, not CPU-bound: keep the ceiling low and
// let the queue absorb bursts.
const CONCURRENCY = Number(process.env.RENDER_CONCURRENCY ?? Math.min(4, Math.max(2, availableParallelism())));

// A pool smaller than the concurrency limit would close and rebuild a page on
// every render, which is the cost the pool exists to remove.
const renderer = new PdfRenderer({
  poolSize: CONCURRENCY,
  maxPageUses: Number(process.env.RENDER_MAX_PAGE_USES ?? 5),
});
const gate = new RenderGate({
  limit: CONCURRENCY,
  maxQueue: Number(process.env.RENDER_QUEUE ?? 50),
  queueTimeoutMs: Number(process.env.RENDER_QUEUE_TIMEOUT_MS ?? 20_000),
});
const cache = new ResultCache({
  maxBytes: Number(process.env.RENDER_CACHE_MB ?? 64) * 1024 * 1024,
  ttlMs: Number(process.env.RENDER_CACHE_TTL_MS ?? 60_000),
});
const jobs = new JobStore({
  ttlMs: Number(process.env.RENDER_JOB_TTL_MS ?? 5 * 60_000),
  maxJobs: Number(process.env.RENDER_JOB_MAX ?? 500),
});
// Nobody is holding a socket for an async job, so it can wait far longer for a
// slot than a synchronous caller.
const JOB_QUEUE_TIMEOUT_MS = Number(process.env.RENDER_JOB_QUEUE_TIMEOUT_MS ?? 120_000);
const templates = new TemplateStore(process.env.TEMPLATE_DIR ?? resolve(ROOT, '.templates'));

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Error('Request body too large');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function send(res: ServerResponse, status: number, type: string, body: string | Uint8Array): void {
  res.writeHead(status, { 'content-type': type, 'access-control-allow-origin': '*' });
  res.end(body);
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
      'access-control-allow-headers': 'content-type',
    });
    res.end();
    return;
  }

  if (url.pathname === '/api/templates' || url.pathname.startsWith('/api/templates/')) {
    return handleTemplates(req, res, url);
  }

  if (url.pathname === '/api/example') {
    const [template, data] = await Promise.all([
      readFile(resolve(ROOT, 'examples/invoice.template.json'), 'utf8'),
      readFile(resolve(ROOT, 'examples/invoice.data.json'), 'utf8'),
    ]);
    return send(res, 200, 'application/json', `{"template":${template},"data":${data}}`);
  }

  if (url.pathname === '/api/health') {
    return send(res, 200, 'application/json', JSON.stringify({ gate: gate.stats, cache: cache.stats, jobs: jobs.size, templates: await templates.count() }));
  }

  const job = url.pathname.match(/^\/api\/jobs\/([\w-]+)(\/result)?$/);
  if (req.method === 'GET' && job) {
    return sendJob(res, job[1]!, job[2] === '/result');
  }

  if (req.method === 'POST' && (url.pathname === '/api/render' || url.pathname === '/api/html')) {
    const raw = await readBody(req);
    const body = JSON.parse(raw);
    // Reject malformed templates here rather than letting the emitter guess.
    const template = parseTemplate(body.template);
    if (url.pathname === '/api/html') {
      return send(res, 200, 'text/html; charset=utf-8', renderer.toHtml(template, body.data, { embedFonts: true }));
    }
    // Identical bytes in → identical PDF out, so a repeat click can be served
    // from cache, or joined to the render already running.
    const key = createHash('sha1').update(raw).digest('hex');

    if (url.searchParams.get('async') === '1' || req.headers['prefer'] === 'respond-async') {
      return startJob(res, key, template, body.data);
    }

    const started = performance.now();
    const hit = cache.get(key);
    const pdf = hit ?? (await render(key, template, body.data));
    const { active, queued } = gate.stats;
    console.log(
      `render ${template.name} → ${(pdf.byteLength / 1024).toFixed(0)}KB in ${Math.round(performance.now() - started)}ms` +
        `${hit ? ' (cached)' : ''} (active ${active}, queued ${queued})`,
    );
    res.writeHead(200, {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="document.pdf"`,
      'x-pdftc-cache': hit ? 'hit' : 'miss',
      'access-control-allow-origin': '*',
    });
    res.end(Buffer.from(pdf));
    return;
  }

  send(res, 404, 'application/json', '{"error":"not found"}');
}

/** `/api/templates` and `/api/templates/:id[/duplicate]`. */
async function handleTemplates(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const rest = url.pathname.slice('/api/templates'.length).replace(/^\//, '');
  const [id = '', action = ''] = rest.split('/');
  const body = async () => JSON.parse((await readBody(req)) || '{}');

  try {
    if (!id) {
      if (req.method === 'GET') return send(res, 200, 'application/json', JSON.stringify(await templates.list()));
      if (req.method === 'POST') {
        const record = await templates.create(await body());
        console.log(`template created ${record.id} (${record.name})`);
        return send(res, 201, 'application/json', JSON.stringify(record));
      }
      return send(res, 405, 'application/json', '{"error":"method not allowed"}');
    }

    if (action === 'duplicate') {
      if (req.method !== 'POST') return send(res, 405, 'application/json', '{"error":"method not allowed"}');
      const record = await templates.duplicate(id, (await body()).name);
      return send(res, 201, 'application/json', JSON.stringify(record));
    }
    if (action) return send(res, 404, 'application/json', '{"error":"not found"}');

    if (req.method === 'GET') return send(res, 200, 'application/json', JSON.stringify(await templates.get(id)));
    if (req.method === 'PUT') {
      const record = await templates.update(id, await body());
      return send(res, 200, 'application/json', JSON.stringify(record));
    }
    if (req.method === 'DELETE') {
      await templates.remove(id);
      return send(res, 204, 'application/json', '');
    }
    return send(res, 405, 'application/json', '{"error":"method not allowed"}');
  } catch (err) {
    if (err instanceof NotFoundError) return send(res, 404, 'application/json', JSON.stringify({ error: err.message }));
    // The client holds an older copy: tell it which rev won so it can offer to
    // reload rather than guessing why the save vanished.
    if (err instanceof ConflictError) return send(res, 409, 'application/json', JSON.stringify({ error: err.message, rev: err.current }));
    throw err;
  }
}

/** Gate + render + populate the cache. Callers check the cache first. */
async function render(key: string, template: Template, data: unknown, queueTimeoutMs?: number): Promise<Uint8Array> {
  const opts = queueTimeoutMs === undefined ? {} : { queueTimeoutMs };
  const pdf = await gate.run(
    key,
    async () => {
      const result = await renderer.render(template, data);
      cache.set(key, result);
      return result;
    },
    opts,
  );
  return pdf;
}

/** Accept the work, answer with an id, render it in the background. */
function startJob(res: ServerResponse, key: string, template: Template, data: unknown): void {
  const record = jobs.create(template.name);

  // A cached result means there is nothing to wait for, but still answer 202 so
  // a client never has to branch on which shape it got back.
  const cached = cache.get(key);
  if (cached) {
    jobs.started(record);
    jobs.succeeded(record, cached);
  } else {
    void runJob(record, key, template, data);
  }

  res.writeHead(202, {
    'content-type': 'application/json',
    location: `/api/jobs/${record.id}`,
    'access-control-allow-origin': '*',
    'access-control-expose-headers': 'location',
  });
  res.end(JSON.stringify({ ...jobs.status(record), statusUrl: `/api/jobs/${record.id}`, resultUrl: `/api/jobs/${record.id}/result` }));
}

async function runJob(record: Job, key: string, template: Template, data: unknown): Promise<void> {
  jobs.started(record);
  try {
    const pdf = await render(key, template, data, JOB_QUEUE_TIMEOUT_MS);
    jobs.succeeded(record, pdf);
    console.log(`job ${record.id} ${record.name} → ${(pdf.byteLength / 1024).toFixed(0)}KB in ${record.finishedAt! - record.startedAt!}ms`);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    jobs.failed(record, message, err instanceof OverloadError ? err.retryAfter : undefined);
    console.error(`job ${record.id} failed: ${message}`);
  }
}

function sendJob(res: ServerResponse, id: string, wantResult: boolean): void {
  const record = jobs.get(id);
  if (!record) return send(res, 404, 'application/json', '{"error":"unknown or expired job"}');

  if (!wantResult) return send(res, 200, 'application/json', JSON.stringify(jobs.status(record)));

  if (record.state === 'error') {
    return send(res, 500, 'application/json', JSON.stringify({ error: record.error, retryAfter: record.retryAfter }));
  }
  if (record.state !== 'done' || !record.result) {
    // 202 keeps polling honest: the id is valid, the bytes are not ready.
    return send(res, 202, 'application/json', JSON.stringify(jobs.status(record)));
  }
  res.writeHead(200, {
    'content-type': 'application/pdf',
    'content-disposition': `inline; filename="document.pdf"`,
    'access-control-allow-origin': '*',
  });
  res.end(Buffer.from(record.result));
}

createServer((req, res) => {
  handle(req, res).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof OverloadError) {
      // Shed load explicitly. A client that knows to back off is worth far more
      // than a connection held open until the process dies.
      console.warn(`503 ${message} (${JSON.stringify(gate.stats)})`);
      res.writeHead(503, {
        'content-type': 'application/json',
        'retry-after': String(err.retryAfter),
        'access-control-allow-origin': '*',
      });
      res.end(JSON.stringify({ error: message, retryAfter: err.retryAfter }));
      return;
    }
    console.error(message);
    send(res, 400, 'application/json', JSON.stringify({ error: message }));
  });
}).listen(PORT, () => console.log(`pdftc api  http://localhost:${PORT}`));

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    gate.drain();
    void renderer.close().finally(() => process.exit(0));
  });
}
