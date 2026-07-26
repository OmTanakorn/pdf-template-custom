/**
 * Render service. Holds one Chromium open for the process lifetime, so a
 * render costs ~150ms instead of ~450ms.
 *
 * Renders go through `RenderGate`: a browser context is expensive enough that
 * unbounded concurrency is how this process dies. See `gate.ts`.
 *
 * POST /api/render  { template, data }  → application/pdf
 * POST /api/html    { template, data }  → text/html (the intermediate document)
 * GET  /api/example                     → the bundled invoice template + data
 * GET  /api/health                      → gate counters
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { availableParallelism } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTemplate } from '@pdftc/schema';
import { PdfRenderer } from '@pdftc/pdf';
import { OverloadError, RenderGate } from './gate.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const PORT = Number(process.env.PORT ?? 8787);
const MAX_BODY = 8 * 1024 * 1024;

const renderer = new PdfRenderer();
const gate = new RenderGate({
  // Chromium contexts are memory-bound, not CPU-bound: keep the ceiling low
  // and let the queue absorb bursts.
  limit: Number(process.env.RENDER_CONCURRENCY ?? Math.min(4, Math.max(2, availableParallelism()))),
  maxQueue: Number(process.env.RENDER_QUEUE ?? 50),
  queueTimeoutMs: Number(process.env.RENDER_QUEUE_TIMEOUT_MS ?? 20_000),
});

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
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type',
    });
    res.end();
    return;
  }

  if (url.pathname === '/api/example') {
    const [template, data] = await Promise.all([
      readFile(resolve(ROOT, 'examples/invoice.template.json'), 'utf8'),
      readFile(resolve(ROOT, 'examples/invoice.data.json'), 'utf8'),
    ]);
    return send(res, 200, 'application/json', `{"template":${template},"data":${data}}`);
  }

  if (url.pathname === '/api/health') {
    return send(res, 200, 'application/json', JSON.stringify(gate.stats));
  }

  if (req.method === 'POST' && (url.pathname === '/api/render' || url.pathname === '/api/html')) {
    const raw = await readBody(req);
    const body = JSON.parse(raw);
    // Reject malformed templates here rather than letting the emitter guess.
    const template = parseTemplate(body.template);
    if (url.pathname === '/api/html') {
      return send(res, 200, 'text/html; charset=utf-8', renderer.toHtml(template, body.data, { embedFonts: true }));
    }
    // Identical bytes in → identical PDF out, so a repeated click can share the
    // render already running rather than start a second one.
    const key = createHash('sha1').update(raw).digest('hex');
    const started = performance.now();
    const pdf = await gate.run(key, () => renderer.render(template, body.data));
    const { active, queued } = gate.stats;
    console.log(
      `render ${template.name} → ${(pdf.byteLength / 1024).toFixed(0)}KB in ${Math.round(performance.now() - started)}ms` +
        ` (active ${active}, queued ${queued})`,
    );
    res.writeHead(200, {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="document.pdf"`,
      'access-control-allow-origin': '*',
    });
    res.end(Buffer.from(pdf));
    return;
  }

  send(res, 404, 'application/json', '{"error":"not found"}');
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
