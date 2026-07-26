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
