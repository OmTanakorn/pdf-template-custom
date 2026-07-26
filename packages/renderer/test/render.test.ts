import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTemplate } from '@pdftc/schema';
import { renderHtml } from '../src/index.ts';
import { resolveTemplate } from '../src/resolve.ts';

const base = {
  version: 1 as const,
  name: 'test',
  body: [
    {
      id: 'tbl',
      type: 'table' as const,
      columns: [{ width: '1fr' as const }, { width: 20 }],
      head: [{ id: 'h', cells: [{ content: [{ id: 'h1', type: 'text' as const, content: 'ชื่อ' }] }, { content: [] }] }],
      body: [
        {
          id: 'r',
          each: { in: 'items', as: 'it', indexAs: 'i' },
          cells: [
            { content: [{ id: 'c1', type: 'text' as const, content: '{{ i + 1 }}. {{ it.name }}' }] },
            { content: [{ id: 'c2', type: 'text' as const, content: '{{ it.qty | number:0 }}' }] },
          ],
        },
      ],
    },
  ],
};

const data = { items: [{ name: 'ก', qty: 1 }, { name: 'ข', qty: 2 }, { name: 'ค', qty: 3 }] };

test('each expands one row per item', () => {
  const resolved = resolveTemplate(parseTemplate(base), data);
  const table = resolved.body[0];
  assert.equal(table?.type, 'table');
  assert.equal(table.type === 'table' && table.body.length, 3);
});

test('row ids stay unique after expansion', () => {
  const resolved = resolveTemplate(parseTemplate(base), data);
  const table = resolved.body[0];
  assert.ok(table?.type === 'table');
  const ids = table.body.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('bindings resolve inside cells', () => {
  const html = renderHtml(parseTemplate(base), data);
  assert.match(html, /1\. ก/);
  assert.match(html, /3\. ค/);
  assert.doesNotMatch(html, /\{\{/);
});

test('visibleIf drops the node', () => {
  const template = parseTemplate({
    ...base,
    body: [{ id: 't', type: 'text', content: 'ยกเลิก', visibleIf: 'doc.cancelled' }],
  });
  assert.doesNotMatch(renderHtml(template, { doc: { cancelled: false } }), /ยกเลิก/);
  assert.match(renderHtml(template, { doc: { cancelled: true } }), /ยกเลิก/);
});

test('html escapes data so bindings cannot inject markup', () => {
  const template = parseTemplate({ ...base, body: [{ id: 't', type: 'text', content: '{{ evil }}' }] });
  const html = renderHtml(template, { evil: '<script>alert(1)</script>' });
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;/);
});

test('fr columns split the space left by fixed columns', () => {
  const html = renderHtml(parseTemplate(base), data);
  assert.match(html, /width:calc\(\(100% - 20mm\) \* 1\)/);
  assert.match(html, /width:20mm/);
});

test('page size honours the preset and orientation', () => {
  const portrait = renderHtml(parseTemplate({ ...base, page: { preset: 'A4' } }), data);
  assert.match(portrait, /@page \{ size: 210mm 297mm/);
  const landscape = renderHtml(parseTemplate({ ...base, page: { preset: 'A4', orientation: 'landscape' } }), data);
  assert.match(landscape, /@page \{ size: 297mm 210mm/);
});

test('a font family does not truncate the style attribute', () => {
  // A quoted family name terminates an unescaped style="…" at its first quote,
  // dropping every declaration after the font.
  const template = parseTemplate({
    ...base,
    body: [{ id: 't', type: 'text', style: { fontFamily: 'Noto Sans Thai', fontSize: 18, color: '#0f172a' }, content: 'ก' }],
  });
  const html = renderHtml(template, data);
  const attr = /data-id="t[^"]*" style="([^"]*)"/.exec(html)?.[1] ?? '';
  assert.match(attr, /font-size:18pt/);
  assert.match(attr, /color:#0f172a/);
  assert.match(attr, /&quot;Noto Sans Thai&quot;/);
});

test('styleRef survives an inline font family', () => {
  const template = parseTemplate({
    ...base,
    styles: { title: { fontSize: 18, fontWeight: 700, color: '#0f172a' } },
    body: [{ id: 't', type: 'text', styleRef: 'title', style: { fontFamily: 'Sarabun' }, content: 'ก' }],
  });
  const attr = /data-id="t[^"]*" style="([^"]*)"/.exec(renderHtml(template, data))?.[1] ?? '';
  assert.match(attr, /font-size:18pt/);
  assert.match(attr, /font-weight:700/);
});

const HOSTILE = '"} body{display:none} @font-face{font-family:"x';

test('a hostile family name cannot escape the style block', () => {
  const template = parseTemplate({
    ...base,
    fonts: [{ family: HOSTILE, src: 'x.ttf' }],
    // The family has to be referenced, or it is filtered out before emission.
    body: [{ id: 't', type: 'text', style: { fontFamily: HOSTILE }, content: 'ก' }],
  });
  const html = renderHtml(template, data);
  assert.doesNotMatch(html, /body\{display:none\}/);
});

test('a data URI font src keeps its semicolon', () => {
  const template = parseTemplate({
    ...base,
    fonts: [{ family: 'X', src: 'data:font/ttf;base64,AAAA' }],
    body: [{ id: 't', type: 'text', style: { fontFamily: 'X' }, content: 'ก' }],
  });
  assert.match(renderHtml(template, data), /url\("data:font\/ttf;base64,AAAA"\)/);
});

test('only the families a template uses get a @font-face rule', () => {
  // The shipped pack is a few megabytes; declaring all of it would inline the
  // whole pack into every rendered document.
  const template = parseTemplate({
    ...base,
    fonts: [
      { family: 'Sarabun', src: 'Sarabun-Regular.ttf' },
      { family: 'Kanit', src: 'Kanit-Regular.ttf' },
      { family: 'Charm', src: 'Charm-Regular.ttf' },
    ],
    defaultStyle: { fontFamily: 'Sarabun' },
    body: [{ id: 't', type: 'text', style: { fontFamily: 'Kanit' }, content: 'ก' }],
  });
  const html = renderHtml(template, data);
  assert.match(html, /font-family:"Sarabun"/);
  assert.match(html, /font-family:"Kanit"/);
  assert.doesNotMatch(html, /font-family:"Charm"/);
});

test('families used only inside a table cell still ship', () => {
  const template = parseTemplate({
    ...base,
    fonts: [{ family: 'Charm', src: 'Charm-Regular.ttf' }],
    body: [
      {
        id: 'tbl',
        type: 'table',
        columns: [{ width: '1fr' }],
        body: [{ id: 'r', cells: [{ content: [{ id: 'c', type: 'text', style: { fontFamily: 'Charm' }, content: 'ก' }] }] }],
      },
    ],
  });
  assert.match(renderHtml(template, data), /font-family:"Charm"/);
});

test('a variable font declares its whole weight axis', () => {
  const template = parseTemplate({
    ...base,
    fonts: [{ family: 'Anuphan', weightRange: [100, 700], src: 'Anuphan-VF.ttf' }],
    body: [{ id: 't', type: 'text', style: { fontFamily: 'Anuphan' }, content: 'ก' }],
  });
  assert.match(renderHtml(template, data), /font-family:"Anuphan";font-weight:100 700/);
});
