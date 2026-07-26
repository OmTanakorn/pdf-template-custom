import { z } from 'zod';

/* ────────────────────────────────────────────────────────────────
 * Units
 * Every length in a template is millimetres, except font sizes and
 * line widths which are points. Editor and renderer share this, so a
 * template dragged in the studio lands on the same spot in the PDF.
 * ──────────────────────────────────────────────────────────────── */

export const Mm = z.number().finite();
export const Pt = z.number().finite().nonnegative();

export const Box = z.object({
  top: Mm.default(0),
  right: Mm.default(0),
  bottom: Mm.default(0),
  left: Mm.default(0),
});

export const Frame = z.object({
  x: Mm,
  y: Mm,
  w: Mm,
  h: Mm.optional(), // omitted => height grows with content
  rotate: z.number().default(0),
});

/* ── Styling ─────────────────────────────────────────────────── */

export const BorderSide = z.object({
  width: Pt.default(0),
  style: z.enum(['solid', 'dashed', 'dotted', 'double']).default('solid'),
  color: z.string().default('#000000'),
});

export const Border = z.object({
  top: BorderSide.optional(),
  right: BorderSide.optional(),
  bottom: BorderSide.optional(),
  left: BorderSide.optional(),
  all: BorderSide.optional(),
});

export const Style = z
  .object({
    fontFamily: z.string(),
    fontSize: Pt,
    fontWeight: z.union([z.number().int(), z.enum(['normal', 'bold'])]),
    italic: z.boolean(),
    underline: z.boolean(),
    lineHeight: z.number().positive(),
    letterSpacing: z.number(),
    color: z.string(),
    background: z.string(),
    align: z.enum(['left', 'center', 'right', 'justify']),
    valign: z.enum(['top', 'middle', 'bottom']),
    padding: Box,
    border: Border,
    radius: Mm,
    opacity: z.number().min(0).max(1),
    whiteSpace: z.enum(['normal', 'pre-wrap', 'nowrap']),
    /** Shrink text until it fits the frame instead of wrapping past it. */
    shrinkToFit: z.boolean(),
  })
  .partial();

export type Style = z.infer<typeof Style>;

/* ── Nodes ───────────────────────────────────────────────────── */

const NodeBase = {
  id: z.string(),
  name: z.string().optional(),
  /** Named style from `template.styles`, merged under the inline `style`. */
  styleRef: z.string().optional(),
  style: Style.optional(),
  /** Binding expression; node is dropped when it evaluates falsy. */
  visibleIf: z.string().optional(),
};

export const TextNode = z.object({
  ...NodeBase,
  type: z.literal('text'),
  /** Literal text with `{{ path | filter }}` interpolation. */
  content: z.string(),
});

export const ImageNode = z.object({
  ...NodeBase,
  type: z.literal('image'),
  /** URL, data URI, or a binding resolving to either. */
  src: z.string(),
  fit: z.enum(['contain', 'cover', 'fill']).default('contain'),
});

export const RectNode = z.object({
  ...NodeBase,
  type: z.literal('rect'),
});

export const LineNode = z.object({
  ...NodeBase,
  type: z.literal('line'),
  orientation: z.enum(['horizontal', 'vertical']).default('horizontal'),
});

export const BarcodeNode = z.object({
  ...NodeBase,
  type: z.literal('barcode'),
  format: z.enum(['qr', 'code128', 'ean13']).default('qr'),
  value: z.string(),
});

export const PageNumberNode = z.object({
  ...NodeBase,
  type: z.literal('pageNumber'),
  /** `{page}` and `{pages}` are substituted at print time. */
  format: z.string().default('{page} / {pages}'),
});

export type Node =
  | z.infer<typeof TextNode>
  | z.infer<typeof ImageNode>
  | z.infer<typeof RectNode>
  | z.infer<typeof LineNode>
  | z.infer<typeof BarcodeNode>
  | z.infer<typeof PageNumberNode>
  | StackNode
  | TableNode;

export interface StackNode {
  id: string;
  name?: string;
  styleRef?: string;
  style?: Style;
  visibleIf?: string;
  type: 'stack';
  direction: 'row' | 'column';
  gap: number;
  /** Repeat the children once per item of the bound array. */
  each?: { in: string; as: string; indexAs?: string };
  children: Node[];
}

export interface Cell {
  content: Node[];
  colSpan?: number;
  rowSpan?: number;
  style?: Style;
  styleRef?: string;
}

export interface Row {
  id: string;
  /** Fixed row height in mm; omitted => grows with content. */
  height?: number;
  style?: Style;
  styleRef?: string;
  /** Repeat this row once per item of the bound array. */
  each?: { in: string; as: string; indexAs?: string };
  cells: Cell[];
}

export interface TableNode {
  id: string;
  name?: string;
  styleRef?: string;
  style?: Style;
  visibleIf?: string;
  type: 'table';
  /** `20` = 20mm fixed, `'1fr'` = share of the remainder, `'auto'` = fit content. */
  columns: { width: number | `${number}fr` | 'auto' }[];
  /** Repeated at the top of every page the table spans. */
  head: Row[];
  body: Row[];
  foot: Row[];
  /** Style applied to every cell unless overridden. */
  cellStyle?: Style;
  /** Style applied to cells of even-indexed body rows (zebra striping). */
  zebraStyle?: Style;
}

const NodeSchema: z.ZodType<Node> = z.lazy(() =>
  z.discriminatedUnion('type', [
    TextNode,
    ImageNode,
    RectNode,
    LineNode,
    BarcodeNode,
    PageNumberNode,
    StackNodeSchema,
    TableNodeSchema,
  ]) as unknown as z.ZodType<Node>,
);

const StackNodeSchema = z.object({
  ...NodeBase,
  type: z.literal('stack'),
  direction: z.enum(['row', 'column']).default('column'),
  gap: Mm.default(0),
  each: z.object({ in: z.string(), as: z.string(), indexAs: z.string().optional() }).optional(),
  children: z.array(NodeSchema),
});

const CellSchema: z.ZodType<Cell> = z.lazy(() =>
  z.object({
    content: z.array(NodeSchema),
    colSpan: z.number().int().positive().optional(),
    rowSpan: z.number().int().positive().optional(),
    style: Style.optional(),
    styleRef: z.string().optional(),
  }),
) as z.ZodType<Cell>;

const RowSchema = z.object({
  id: z.string(),
  height: Mm.optional(),
  style: Style.optional(),
  styleRef: z.string().optional(),
  each: z.object({ in: z.string(), as: z.string(), indexAs: z.string().optional() }).optional(),
  cells: z.array(CellSchema),
});

const TableNodeSchema = z.object({
  ...NodeBase,
  type: z.literal('table'),
  columns: z.array(
    z.object({
      width: z.union([z.number(), z.custom<`${number}fr`>((v) => typeof v === 'string' && /^\d+(\.\d+)?fr$/.test(v)), z.literal('auto')]),
    }),
  ),
  head: z.array(RowSchema).default([]),
  body: z.array(RowSchema).default([]),
  foot: z.array(RowSchema).default([]),
  cellStyle: Style.optional(),
  zebraStyle: Style.optional(),
});

/* ── Layers ──────────────────────────────────────────────────── */

/** A node pinned to an exact spot — this is what drag-and-drop produces. */
export const Placed = z.object({
  frame: Frame,
  node: NodeSchema,
  /** Which pages it appears on. */
  on: z.union([z.enum(['all', 'first', 'last', 'exceptFirst']), z.array(z.number().int().positive())]).default('all'),
});

export const Band = z.object({
  /** Reserved strip height in mm. The flow region shrinks to make room. */
  height: Mm.default(0),
  items: z.array(Placed).default([]),
});

export const PageSetup = z.object({
  /** Named size fills width/height when they are omitted. */
  preset: z.enum(['A4', 'A5', 'Letter', 'Legal', 'custom']).default('A4'),
  width: Mm.optional(),
  height: Mm.optional(),
  orientation: z.enum(['portrait', 'landscape']).default('portrait'),
  margin: Box.default({ top: 15, right: 15, bottom: 15, left: 15 }),
  background: z.string().optional(),
});

const DEFAULT_PAGE: z.infer<typeof PageSetup> = {
  preset: 'A4',
  orientation: 'portrait',
  margin: { top: 15, right: 15, bottom: 15, left: 15 },
};

export const FontFace = z.object({
  family: z.string(),
  weight: z.union([z.number().int(), z.literal('normal'), z.literal('bold')]).default(400),
  /**
   * Variable-font weight axis, e.g. `[100, 900]`. One file then covers every
   * weight, so a family costs ~250KB instead of one file per weight.
   */
  weightRange: z.tuple([z.number(), z.number()]).optional(),
  italic: z.boolean().default(false),
  /** Path relative to the font pack, or an absolute path / data URI. */
  src: z.string(),
});

export const Template = z.object({
  version: z.literal(1),
  name: z.string().default('Untitled'),
  page: PageSetup.default(DEFAULT_PAGE),
  fonts: z.array(FontFace).default([]),
  /** Reusable named styles, referenced by `styleRef`. */
  styles: z.record(z.string(), Style).default({}),
  /** Style every node inherits before its own. */
  defaultStyle: Style.default({ fontFamily: 'Sarabun', fontSize: 10, color: '#000000', lineHeight: 1.4 }),
  header: Band.default({ height: 0, items: [] }),
  footer: Band.default({ height: 0, items: [] }),
  /** Absolute layer drawn over the flow region — stamps, logos, signatures. */
  overlay: z.array(Placed).default([]),
  /** Flow region: paginates, tables break across pages with repeating heads. */
  body: z.array(NodeSchema).default([]),
});

export type Template = z.infer<typeof Template>;
export type Placed = z.infer<typeof Placed>;
export type Band = z.infer<typeof Band>;
export type Frame = z.infer<typeof Frame>;
export type PageSetup = z.infer<typeof PageSetup>;
export type FontFace = z.infer<typeof FontFace>;
export type Border = z.infer<typeof Border>;
export type Box = z.infer<typeof Box>;

export const PAGE_PRESETS: Record<string, { width: number; height: number }> = {
  A4: { width: 210, height: 297 },
  A5: { width: 148, height: 210 },
  Letter: { width: 215.9, height: 279.4 },
  Legal: { width: 215.9, height: 355.6 },
};

/** Resolve preset + orientation into concrete millimetre dimensions. */
export function pageSize(page: PageSetup): { width: number; height: number } {
  const preset = PAGE_PRESETS[page.preset] ?? PAGE_PRESETS.A4!;
  let width = page.width ?? preset.width;
  let height = page.height ?? preset.height;
  if (page.orientation === 'landscape' && height > width) [width, height] = [height, width];
  return { width, height };
}

export function parseTemplate(input: unknown): Template {
  return Template.parse(input);
}
