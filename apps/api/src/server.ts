/**
 * Render service. Holds one Chromium open for the process lifetime, so a
 * render costs ~150ms instead of ~450ms.
 *
 * POST /api/render  { template, data }  → application/pdf
 * POST /api/html    { template, data }  → text/html (the intermediate document)
 * GET  /api/example                     → the bundled invoice template + data
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTemplate } from '@pdftc/schema';
import { PdfRenderer } from '@pdftc/pdf';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const PORT = Number(process.env.PORT ?? 8787);
const MAX_BODY = 8 * 1024 * 1024;

const renderer = new PdfRenderer();

async function readJson(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new Error('Request body too large');
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
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

  if (req.method === 'POST' && (url.pathname === '/api/render' || url.pathname === '/api/html')) {
    const body = await readJson(req);
    // Reject malformed templates here rather than letting the emitter guess.
    const template = parseTemplate(body.template);
    if (url.pathname === '/api/html') {
      return send(res, 200, 'text/html; charset=utf-8', renderer.toHtml(template, body.data, { embedFonts: true }));
    }
    const started = performance.now();
    const pdf = await renderer.render(template, body.data);
    console.log(`render ${template.name} → ${(pdf.byteLength / 1024).toFixed(0)}KB in ${Math.round(performance.now() - started)}ms`);
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
    console.error(message);
    send(res, 400, 'application/json', JSON.stringify({ error: message }));
  });
}).listen(PORT, () => console.log(`pdftc api  http://localhost:${PORT}`));

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void renderer.close().finally(() => process.exit(0));
  });
}
