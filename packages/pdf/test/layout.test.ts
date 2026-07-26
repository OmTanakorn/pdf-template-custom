/**
 * Layout regression: the paginator is the part of this engine with no natural
 * unit test — its output is where things ended up on the page. So the snapshot
 * is exactly that: for every element the emitter tagged, which page it landed
 * on and its box in millimetres, plus the text of each page.
 *
 * Geometry rather than pixels. A PNG diff would fail on every Chromium
 * antialiasing change while staying silent about a table that quietly stopped
 * repeating its header, and a committed PNG cannot be reviewed in a diff.
 * Millimetres are the unit the template is written in, so a broken snapshot
 * reads as "this cell moved 4mm down", which is the thing that actually went
 * wrong.
 *
 * Refresh after an intentional layout change:
 *
 *     SNAPSHOT=update pnpm test
 *
 * and read the diff before committing it — that diff is the review.
 */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderHtml } from '@pdftc/renderer';
import { parseTemplate, type Template } from '@pdftc/schema';
import { chromium, type Browser } from 'playwright';
import { PdfRenderer } from '../src/index.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../../..');
const SNAPSHOTS = join(HERE, 'snapshots');
const UPDATE = process.env.SNAPSHOT === 'update';

/** A box may drift this far and still be the same layout (sub-pixel rounding). */
const TOLERANCE_MM = 0.35;

/** `[data-id, page index, x, y, w, h]` — an array so the file stays readable. */
type Box = [string, number, number, number, number, number];

interface Layout {
  pages: number;
  text: string[];
  boxes: Box[];
}

let browser: Browser;

before(async () => {
  browser = await chromium.launch();
});

after(async () => {
  await browser.close();
});

async function layoutOf(template: Template, data: unknown): Promise<Layout> {
  const page = await browser.newPage();
  try {
    await page.setContent(renderHtml(template, data), { waitUntil: 'load' });
    await page.waitForFunction(() => document.documentElement.getAttribute('data-pdftc-ready') === '1');
    // No helper functions inside `evaluate`: the test runner transpiles this
    // file, and the name-preserving wrapper it emits does not exist in the page.
    const raw = await page.evaluate(() => {
      const pages = document.querySelectorAll<HTMLElement>('.page');
      const text: string[] = [];
      const boxes: Array<[string, number, number, number, number, number]> = [];

      for (let index = 0; index < pages.length; index++) {
        const pageEl = pages[index]!;
        const origin = pageEl.getBoundingClientRect();
        text.push((pageEl.textContent ?? '').replace(/\s+/g, ' ').trim());

        const tagged = pageEl.querySelectorAll<HTMLElement>('[data-id]');
        for (let i = 0; i < tagged.length; i++) {
          const el = tagged[i]!;
          const rect = el.getBoundingClientRect();
          // Relative to its own page: page N sitting lower in the viewport is
          // not a layout change, a cell moving inside its page is.
          boxes.push([
            el.getAttribute('data-id') ?? '',
            index,
            rect.left - origin.left,
            rect.top - origin.top,
            rect.width,
            rect.height,
          ]);
        }
      }
      return { pages: pages.length, text, boxes };
    });

    const mm = (px: number) => Math.round(px * (25.4 / 96) * 100) / 100;
    return {
      pages: raw.pages,
      text: raw.text,
      // `resolve.ts` suffixes cloned ids from a counter that lives as long as
      // the process, so the same template rendered second in a run gets
      // different suffixes. Compare the template's own id; the boxes are
      // matched by position anyway.
      boxes: raw.boxes.map(([id, page, x, y, w, h]) => [id.replace(/__[0-9a-z]+$/, ''), page, mm(x), mm(y), mm(w), mm(h)] as Box),
    };
  } finally {
    await page.close();
  }
}

function check(name: string, actual: Layout): void {
  const path = join(SNAPSHOTS, `${name}.json`);
  let expected: Layout;
  try {
    expected = JSON.parse(readFileSync(path, 'utf8')) as Layout;
  } catch {
    // A missing snapshot writes itself. The commit is where it gets reviewed.
    mkdirSync(SNAPSHOTS, { recursive: true });
    writeFileSync(path, format(actual), 'utf8');
    console.log(`snapshot written: ${name}`);
    return;
  }

  if (UPDATE) {
    writeFileSync(path, format(actual), 'utf8');
    return;
  }

  assert.equal(actual.pages, expected.pages, `${name}: page count`);
  assert.deepEqual(actual.text, expected.text, `${name}: page text`);
  assert.equal(actual.boxes.length, expected.boxes.length, `${name}: element count`);

  const moved: string[] = [];
  for (const [index, box] of actual.boxes.entries()) {
    const want = expected.boxes[index]!;
    if (box[0] !== want[0] || box[1] !== want[1]) {
      moved.push(`${want[0]} (page ${want[1]}) → ${box[0]} (page ${box[1]})`);
      continue;
    }
    for (const axis of [2, 3, 4, 5] as const) {
      if (Math.abs(box[axis] - want[axis]) > TOLERANCE_MM) {
        moved.push(`${box[0]} ${'xywh'[axis - 2]}: ${want[axis]} → ${box[axis]}`);
      }
    }
  }
  assert.deepEqual(moved, [], `${name}: layout moved (run SNAPSHOT=update to accept)`);
}

/** One box per line: a moved element is one line of diff, not a reflowed file. */
function format(layout: Layout): string {
  const boxes = layout.boxes.map((box) => `    ${JSON.stringify(box)}`).join(',\n');
  return `{\n  "pages": ${layout.pages},\n  "text": ${JSON.stringify(layout.text, null, 2).replace(/\n/g, '\n  ')},\n  "boxes": [\n${boxes}\n  ]\n}\n`;
}

function example(): { template: Template; data: unknown } {
  return {
    template: parseTemplate(JSON.parse(readFileSync(join(ROOT, 'examples/invoice.template.json'), 'utf8'))),
    data: JSON.parse(readFileSync(join(ROOT, 'examples/invoice.data.json'), 'utf8')),
  };
}

test('the bundled invoice lays out where it did last time', async () => {
  const { template, data } = example();
  check('invoice', await layoutOf(template, data));
});

test('a header repeats and a footer does not, across every page', async () => {
  const { template, data } = example();
  const layout = await layoutOf(template, data);
  assert.ok(layout.pages > 1, 'the example must span more than one page to prove anything');

  // The `thead` is emitted once per slice, so its id appears once per page.
  const headIds = new Set(template.body.flatMap((node) => (node.type === 'table' ? node.head.map((row) => row.id) : [])));
  for (const id of headIds) {
    const onPages = layout.boxes.filter((box) => box[0] === id).map((box) => box[1]);
    assert.deepEqual(onPages, [...Array(layout.pages).keys()], `head row ${id} should repeat on every page`);
  }

  const footIds = new Set(template.body.flatMap((node) => (node.type === 'table' ? node.foot.map((row) => row.id) : [])));
  for (const id of footIds) {
    const onPages = layout.boxes.filter((box) => box[0] === id).map((box) => box[1]);
    assert.deepEqual(onPages, [layout.pages - 1], `foot row ${id} belongs on the last page only`);
  }
});

test('a rowspan crossing two page boundaries keeps one continuation per slice', async () => {
  const rows = Array.from({ length: 14 }, (_, i) => ({
    id: `r${i}`,
    height: 12,
    cells: i === 0 ? [cell('anchor', { rowSpan: 14 }), cell(`b${i}`)] : [cell(`b${i}`)],
  }));
  const template = parseTemplate({
    version: 1,
    name: 'rowspan across three pages',
    page: { preset: 'custom', width: 90, height: 70, margin: { top: 5, right: 5, bottom: 5, left: 5 } },
    defaultStyle: { fontSize: 9, lineHeight: 1 },
    body: [
      {
        id: 'tbl',
        type: 'table',
        columns: [{ width: 30 }, { width: 50 }],
        head: [{ id: 'h', height: 8, cells: [cell('h0'), cell('h1')] }],
        body: rows,
        foot: [],
      },
    ],
  });

  const layout = await layoutOf(template, {});
  assert.ok(layout.pages >= 3, `expected at least three pages, got ${layout.pages}`);

  // The spanning cell carries content on its first page only; the continuations
  // are empty, so the text must appear exactly once in the whole document.
  const anchors = layout.text.join(' ').match(/anchor/g) ?? [];
  assert.equal(anchors.length, 1);

  // Every row keeps both of its columns filled, on every slice.
  const rowIds = layout.boxes.filter((box) => /^r\d+$/.test(box[0]));
  assert.equal(rowIds.length, rows.length, 'no row may be dropped or duplicated by the split');
  check('rowspan-three-pages', layout);
});

function cell(id: string, extra: Record<string, unknown> = {}) {
  return { ...extra, content: [{ id: `${id}-t`, type: 'text', content: id }] };
}

test('the printed PDF has the page count the DOM paginated to', async () => {
  const { template, data } = example();
  const layout = await layoutOf(template, data);

  const renderer = new PdfRenderer({ poolSize: 1 });
  try {
    const pdf = await renderer.render(template, data);
    // Chromium writes the page tree uncompressed, so the count is readable
    // without a PDF parser: this is a smoke test that pagination survives print.
    const count = Buffer.from(pdf).toString('latin1').match(/\/Count\s+(\d+)/);
    assert.ok(count, 'no page tree found in the PDF');
    assert.equal(Number(count[1]), layout.pages);
  } finally {
    await renderer.close();
  }
});
