/**
 * Structure → HTML. Pure: no filesystem, no browser globals, so the studio
 * canvas and the server renderer produce byte-identical markup.
 *
 * Layout model
 * ────────────
 * `body` is flow content that the injected paginator slices into fixed-size
 * `.page` elements. `header`, `footer` and `overlay` are absolutely placed
 * layers stamped onto each page after slicing — that is what drag-and-drop
 * in the studio writes.
 */

import { pageSize, type Cell, type Node, type Placed, type Row, type Style, type TableNode, type Template } from '@pdftc/schema';
import { cssSafe, cssUrl, escapeAttr, escapeHtml, mergeStyles, mm, styleAttr, styleToCss } from './css.js';
import { PAGINATOR_SOURCE } from './paginator.js';

export interface EmitOptions {
  /**
   * How font files are referenced. `data` inlines them (self-contained HTML,
   * required when Chromium runs sandboxed with no filesystem access);
   * `url` keeps the `src` as written.
   */
  fontResolver?: (src: string) => string;
  /** Draw margin/region guides. Studio only — never on for a real render. */
  guides?: boolean;
  /** Skip the paginator, e.g. when the studio drives it itself. */
  inlinePaginator?: boolean;
  /**
   * On-screen page shadows and grey backdrop. Off for the studio, whose
   * canvas overlays drag handles and needs page 1 to start at (0, 0).
   */
  screenChrome?: boolean;
}

interface Ctx {
  template: Template;
  opts: EmitOptions;
}

function styleOf(ctx: Ctx, node: { style?: Style; styleRef?: string }, ...extra: (Style | undefined)[]): Style {
  const named = node.styleRef ? ctx.template.styles[node.styleRef] : undefined;
  return mergeStyles(...extra, named, node.style);
}

/* ── Nodes ───────────────────────────────────────────────────── */

function emitNode(ctx: Ctx, node: Node, inherited?: Style): string {
  const s = styleOf(ctx, node, inherited);
  const css = styleToCss(s);
  const id = escapeAttr(node.id);

  switch (node.type) {
    case 'text': {
      const shrink = s.shrinkToFit ? ' data-shrink="1"' : '';
      return `<div class="n text" data-id="${id}"${shrink} style="${styleAttr(css)}">${escapeHtml(node.content).replace(/\n/g, '<br>')}</div>`;
    }

    case 'rect':
      return `<div class="n rect" data-id="${id}" style="${styleAttr(css)}"></div>`;

    case 'line': {
      const thickness = node.style?.border?.all?.width ?? 0.5;
      const color = node.style?.border?.all?.color ?? s.color ?? '#000';
      const rule =
        node.orientation === 'vertical'
          ? `border-left:${thickness}pt solid ${color};height:100%;width:0`
          : `border-top:${thickness}pt solid ${color};width:100%;height:0`;
      return `<div class="n line" data-id="${id}" style="${styleAttr(`${css};${rule}`)}"></div>`;
    }

    case 'image':
      return `<img class="n image" data-id="${id}" style="${styleAttr(`${css};object-fit:${node.fit};width:100%;height:100%`)}" src="${escapeAttr(node.src)}" alt="">`;

    case 'barcode':
      // Encoding happens in a prepare step that swaps this for an <img>.
      return `<div class="n barcode" data-id="${id}" data-format="${escapeAttr(node.format)}" data-value="${escapeAttr(node.value)}" style="${styleAttr(css)}"></div>`;

    case 'pageNumber':
      return `<div class="n page-number" data-id="${id}" data-format="${escapeAttr(node.format)}" style="${styleAttr(css)}"></div>`;

    case 'stack': {
      const flex = `display:flex;flex-direction:${node.direction};gap:${mm(node.gap)}`;
      const children = node.children.map((c) => emitNode(ctx, c, undefined)).join('');
      return `<div class="n stack" data-id="${id}" style="${styleAttr(`${css};${flex}`)}">${children}</div>`;
    }

    case 'table':
      return emitTable(ctx, node, s);
  }
}

/* ── Tables ──────────────────────────────────────────────────── */

function emitColgroup(node: TableNode): string {
  const fixedTotal = node.columns.reduce((sum, c) => sum + (typeof c.width === 'number' ? c.width : 0), 0);
  const frTotal = node.columns.reduce((sum, c) => sum + (typeof c.width === 'string' && c.width.endsWith('fr') ? parseFloat(c.width) : 0), 0);

  const cols = node.columns.map((c) => {
    if (typeof c.width === 'number') return `<col style="width:${mm(c.width)}">`;
    if (c.width === 'auto') return `<col>`;
    const share = parseFloat(c.width) / (frTotal || 1);
    // Remaining space after the fixed columns, split by fr share.
    return `<col style="width:calc((100% - ${mm(fixedTotal)}) * ${Number(share.toFixed(6))})">`;
  });
  return `<colgroup>${cols.join('')}</colgroup>`;
}

function emitCell(ctx: Ctx, cell: Cell, node: TableNode, rowStyle: Style, zebra: boolean): string {
  const base = mergeStyles(node.cellStyle, zebra ? node.zebraStyle : undefined, rowStyle);
  const s = styleOf(ctx, cell, base);
  const attrs = [cell.colSpan ? ` colspan="${cell.colSpan}"` : '', cell.rowSpan ? ` rowspan="${cell.rowSpan}"` : ''].join('');
  const inner = cell.content.map((c) => emitNode(ctx, c, undefined)).join('');
  return `<td${attrs} style="${styleAttr(styleToCss(s))}">${inner}</td>`;
}

function emitRow(ctx: Ctx, row: Row, node: TableNode, index: number, section: 'head' | 'body' | 'foot'): string {
  const rowStyle = styleOf(ctx, row);
  const zebra = section === 'body' && index % 2 === 1;
  const height = row.height != null ? `height:${mm(row.height)};` : '';
  const cells = row.cells.map((c) => emitCell(ctx, c, node, rowStyle, zebra)).join('');
  return `<tr data-id="${escapeAttr(row.id)}" style="${styleAttr(`${height}${styleToCss(rowStyle)}`)}">${cells}</tr>`;
}

function emitTable(ctx: Ctx, node: TableNode, s: Style): string {
  const hasAuto = node.columns.some((c) => c.width === 'auto');
  const layout = hasAuto ? 'auto' : 'fixed';
  const head = node.head.length ? `<thead>${node.head.map((r, i) => emitRow(ctx, r, node, i, 'head')).join('')}</thead>` : '';
  const foot = node.foot.length ? `<tfoot>${node.foot.map((r, i) => emitRow(ctx, r, node, i, 'foot')).join('')}</tfoot>` : '';
  const body = `<tbody>${node.body.map((r, i) => emitRow(ctx, r, node, i, 'body')).join('')}</tbody>`;
  return `<table class="n tbl" data-id="${escapeAttr(node.id)}" style="${styleAttr(`${styleToCss(s)};table-layout:${layout}`)}">${emitColgroup(node)}${head}${body}${foot}</table>`;
}

/* ── Absolute layers ─────────────────────────────────────────── */

function emitPlaced(ctx: Ctx, item: Placed, yOffset: number): string {
  const { frame } = item;
  const box = [
    'position:absolute',
    `left:${mm(frame.x)}`,
    `top:${mm(frame.y + yOffset)}`,
    `width:${mm(frame.w)}`,
    frame.h != null ? `height:${mm(frame.h)}` : '',
    frame.rotate ? `transform:rotate(${frame.rotate}deg);transform-origin:top left` : '',
  ]
    .filter(Boolean)
    .join(';');
  const on = Array.isArray(item.on) ? item.on.join(',') : item.on;
  return `<div class="placed" data-on="${escapeAttr(on)}" style="${styleAttr(box)}">${emitNode(ctx, item.node)}</div>`;
}

/* ── Fonts ───────────────────────────────────────────────────── */

function emitFontFaces(ctx: Ctx): string {
  const resolve = ctx.opts.fontResolver ?? ((src: string) => src);
  return ctx.template.fonts
    .map((f) => {
      // A `<style>` block is not HTML-escaped, so a quote or brace in either
      // value would end the rule — or the whole element.
      const url = cssUrl(resolve(f.src));
      const family = cssSafe(f.family);
      const weight = f.weight === 'normal' ? 400 : f.weight === 'bold' ? 700 : f.weight;
      return `@font-face{font-family:"${family}";font-weight:${weight};font-style:${f.italic ? 'italic' : 'normal'};src:url("${url}");font-display:block}`;
    })
    .join('\n');
}

/* ── Document ────────────────────────────────────────────────── */

export function emitHtml(template: Template, opts: EmitOptions = {}): string {
  const ctx: Ctx = { template, opts };
  const { width, height } = pageSize(template.page);
  const m = template.page.margin;

  // Header and footer bands eat into the flow region on every page.
  const contentTop = m.top + template.header.height;
  const contentBottom = m.bottom + template.footer.height;
  const contentLeft = m.left;
  const contentWidth = width - m.left - m.right;
  const contentHeight = height - contentTop - contentBottom;

  const layers = [
    ...template.header.items.map((i) => emitPlaced(ctx, i, m.top)),
    ...template.overlay.map((i) => emitPlaced(ctx, i, 0)),
    ...template.footer.items.map((i) => emitPlaced(ctx, i, height - m.bottom - template.footer.height)),
  ].join('');

  const flow = template.body.map((n) => emitNode(ctx, n, template.defaultStyle)).join('');

  const config = {
    pageWidth: width,
    pageHeight: height,
    contentTop,
    contentLeft,
    contentWidth,
    contentHeight,
    guides: Boolean(opts.guides),
  };

  const css = `
${emitFontFaces(ctx)}
@page { size: ${mm(width)} ${mm(height)}; margin: 0; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; }
body {
  ${styleToCss(template.defaultStyle)};
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
  /* Unhinted, fractional glyph advances. Without this, text measures wider in
     a stock browser than in the headless render, and the studio preview breaks
     lines the PDF does not. */
  text-rendering: geometricPrecision;
  font-kerning: normal;
}
.page {
  position: relative;
  width: ${mm(width)};
  height: ${mm(height)};
  overflow: hidden;
  background: ${template.page.background ?? '#fff'};
  break-after: page;
  page-break-after: always;
}
.page:last-child { break-after: auto; page-break-after: auto; }
.page-content {
  position: absolute;
  left: ${mm(contentLeft)};
  top: ${mm(contentTop)};
  width: ${mm(contentWidth)};
  height: ${mm(contentHeight)};
  overflow: hidden;
}
.page-layer { position: absolute; inset: 0; }
.n { margin: 0; }
.tbl { width: 100%; border-collapse: collapse; }
.tbl td { vertical-align: top; word-break: break-word; overflow-wrap: anywhere; }
.text { overflow-wrap: anywhere; }
#flow { position: absolute; left: -10000mm; top: 0; width: ${mm(contentWidth)}; visibility: hidden; }
.guides .page-content { outline: 0.2mm dashed #7c9; outline-offset: 0; }
${
  opts.screenChrome === false
    ? '@media screen { .page + .page { border-top: 1px solid #cbd5e1; } }'
    : '@media screen { body { background: #e5e7eb; padding: 8mm 0; } .page { margin: 0 auto 8mm; box-shadow: 0 2px 12px rgba(0,0,0,.18); } }'
}
`.trim();

  const paginator = opts.inlinePaginator === false ? '' : `<script>${PAGINATOR_SOURCE}</script>`;

  return `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="utf-8">
<title>${escapeHtml(template.name)}</title>
<style>${css}</style>
</head>
<body class="${opts.guides ? 'guides' : ''}">
<template id="layers">${layers}</template>
<div id="flow">${flow}</div>
<div id="pages"></div>
<script>window.__PDFTC__ = ${JSON.stringify(config)};</script>
${paginator}
</body>
</html>`;
}
