import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { renderHtml } from '@pdftc/renderer';
import { parseTemplate } from '@pdftc/schema';
import { chromium, type Browser, type Page } from 'playwright';

let browser: Browser | undefined;

before(async () => {
  browser = await chromium.launch({ args: ['--font-render-hinting=none', '--disable-lcd-text'] });
});

after(async () => {
  await browser?.close();
});

function textCell(id: string, extra: Record<string, unknown> = {}) {
  return {
    ...extra,
    content: [{ id: `${id}-text`, type: 'text', content: id }],
  };
}

function fullRow(id: string) {
  return {
    id,
    height: 20,
    cells: [0, 1, 2, 3].map((column) => textCell(`${id}-${column}`)),
  };
}

function templateWithSpan(crossesPage: boolean) {
  const spanStart = crossesPage
    ? {
        id: 'r1',
        height: 20,
        cells: [
          textCell('r1-0'),
          textCell('span-content', {
            colSpan: 2,
            rowSpan: 4,
            style: { background: '#fde68a', border: { all: { width: 1, color: '#92400e' } } },
          }),
          textCell('r1-3'),
        ],
      }
    : {
        id: 'r0',
        height: 20,
        cells: [
          textCell('r0-0'),
          textCell('span-content', {
            colSpan: 2,
            rowSpan: 2,
            style: { background: '#fde68a', border: { all: { width: 1, color: '#92400e' } } },
          }),
          textCell('r0-3'),
        ],
      };

  const body = crossesPage
    ? [
        fullRow('r0'),
        spanStart,
        { id: 'r2', height: 20, cells: [textCell('r2-0'), textCell('r2-3')] },
        { id: 'r3', height: 20, cells: [textCell('r3-0'), textCell('r3-3')] },
        { id: 'r4', height: 20, cells: [textCell('r4-0'), textCell('r4-3')] },
        fullRow('r5'),
      ]
    : [
        spanStart,
        { id: 'r1', height: 20, cells: [textCell('r1-0'), textCell('r1-3')] },
        fullRow('r2'),
        fullRow('r3'),
        fullRow('r4'),
        fullRow('r5'),
      ];

  return parseTemplate({
    version: 1,
    name: 'rowspan pagination',
    page: {
      preset: 'custom',
      width: 100,
      height: 85,
      margin: { top: 5, right: 5, bottom: 5, left: 5 },
    },
    defaultStyle: { fontSize: 10, lineHeight: 1 },
    body: [
      {
        id: 'table',
        type: 'table',
        columns: [{ width: 20 }, { width: 25 }, { width: 25 }, { width: 20 }],
        cellStyle: { padding: { top: 1, right: 1, bottom: 1, left: 1 } },
        head: [
          {
            id: 'head',
            height: 8,
            cells: [0, 1, 2, 3].map((column) => textCell(`head-${column}`)),
          },
        ],
        body,
        foot: [],
      },
    ],
  });
}

async function load(template: ReturnType<typeof templateWithSpan>): Promise<Page> {
  assert.ok(browser);
  const page = await browser.newPage();
  await page.setContent(renderHtml(template, {}), { waitUntil: 'load' });
  await page.waitForFunction(() => document.documentElement.getAttribute('data-pdftc-ready') === '1');
  return page;
}

async function inspect(page: Page) {
  return page.evaluate(() => {
    const columnCount = 4;
    const tables = Array.from(document.querySelectorAll<HTMLTableElement>('.page-content > table'));
    const coverage: boolean[] = [];
    const overruns: string[] = [];
    let rowCount = 0;
    let emptyCellCount = 0;

    for (const table of tables) {
      const rows = Array.from(table.tBodies[0]?.rows ?? []);
      const grid: boolean[][] = rows.map(() => []);
      rowCount += rows.length;

      for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
        let column = 0;
        for (const cell of Array.from(rows[rowIndex]!.cells)) {
          if (cell.textContent?.trim() === '') emptyCellCount++;
          while (grid[rowIndex]![column]) column++;
          if (rowIndex + cell.rowSpan > rows.length) {
            overruns.push(`${rowIndex}+${cell.rowSpan}>${rows.length}`);
          }
          for (let r = rowIndex; r < Math.min(rows.length, rowIndex + cell.rowSpan); r++) {
            for (let c = column; c < column + cell.colSpan; c++) grid[r]![c] = true;
          }
          column += cell.colSpan;
        }
      }

      for (const row of grid) {
        coverage.push(
          row.length === columnCount &&
            Array.from({ length: columnCount }, (_, column) => Boolean(row[column])).every(Boolean),
        );
      }
    }

    const pageText = document.getElementById('pages')?.textContent ?? '';
    return {
      tableCount: tables.length,
      rowCount,
      coverage,
      overruns,
      emptyCellCount,
      spanTextCount: pageText.split('span-content').length - 1,
      secondSliceFirstRow:
        tables[1]?.tBodies[0]?.rows[0] == null
          ? []
          : Array.from(tables[1].tBodies[0].rows[0].cells).map((cell) => ({
              text: cell.textContent?.trim() ?? '',
              colSpan: cell.colSpan,
              rowSpan: cell.rowSpan,
            })),
      emptyContinuationStyle:
        Array.from(document.querySelectorAll<HTMLTableCellElement>('tbody td'))
          .find((cell) => cell.textContent?.trim() === '')
          ?.style.cssText ?? '',
    };
  });
}

test('rowspan crossing a page boundary is continued without duplicating content', async () => {
  const page = await load(templateWithSpan(true));
  try {
    const result = await inspect(page);
    assert.equal(result.tableCount, 2);
    assert.equal(result.rowCount, 6);
    assert.ok(result.coverage.every(Boolean));
    assert.deepEqual(result.overruns, []);
    assert.equal(result.spanTextCount, 1);
    assert.equal(result.emptyCellCount, 1);
    assert.deepEqual(result.secondSliceFirstRow, [
      { text: 'r3-0', colSpan: 1, rowSpan: 1 },
      { text: '', colSpan: 2, rowSpan: 2 },
      { text: 'r3-3', colSpan: 1, rowSpan: 1 },
    ]);
    assert.match(result.emptyContinuationStyle, /background:\s*(?:#fde68a|rgb\(253, 230, 138\))/);
  } finally {
    await page.close();
  }
});

test('rowspan wholly inside a table slice keeps the simple split path', async () => {
  const page = await load(templateWithSpan(false));
  try {
    const result = await inspect(page);
    assert.equal(result.tableCount, 2);
    assert.equal(result.rowCount, 6);
    assert.ok(result.coverage.every(Boolean));
    assert.deepEqual(result.overruns, []);
    assert.equal(result.spanTextCount, 1);
    assert.equal(result.emptyCellCount, 0);
  } finally {
    await page.close();
  }
});
