#!/usr/bin/env -S node --import tsx
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { parseTemplate } from '@pdftc/schema';
import { PdfRenderer } from './index.js';

const { values } = parseArgs({
  options: {
    template: { type: 'string', short: 't' },
    data: { type: 'string', short: 'd' },
    out: { type: 'string', short: 'o', default: 'out.pdf' },
    html: { type: 'string' },
    embed: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (values.help || !values.template) {
  console.log(`Usage: pnpm render -t <template.json> -d <data.json> [-o out.pdf] [--html debug.html] [--embed]

  -t, --template  Template JSON (required)
  -d, --data      Data JSON bound into the template
  -o, --out       Output PDF path            (default: out.pdf)
      --html      Also write the intermediate HTML for debugging
      --embed     Inline fonts as data URIs so the HTML is portable`);
  process.exit(values.help ? 0 : 1);
}

const template = parseTemplate(JSON.parse(readFileSync(values.template, 'utf8')));
const data = values.data ? JSON.parse(readFileSync(values.data, 'utf8')) : {};

const renderer = new PdfRenderer();
try {
  if (values.html) {
    writeFileSync(values.html, renderer.toHtml(template, data, { embedFonts: true }));
    console.log(`html  → ${values.html}`);
  }
  const started = performance.now();
  const pdf = await renderer.render(template, data, { embedFonts: values.embed });
  writeFileSync(values.out!, pdf);
  console.log(`pdf   → ${values.out}  (${(pdf.byteLength / 1024).toFixed(1)} KB, ${Math.round(performance.now() - started)} ms)`);
} finally {
  await renderer.close();
}
