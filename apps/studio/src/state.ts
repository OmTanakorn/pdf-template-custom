import type { Node, Placed, Style, Template } from '@pdftc/schema';
import { pageSize } from '@pdftc/schema';

export type LayerName = 'header' | 'overlay' | 'footer';

/** What the inspector is pointed at. Placed items are also drag targets. */
export type Selection = { kind: 'placed'; layer: LayerName; index: number } | { kind: 'body'; index: number } | { kind: 'page' } | null;

export interface EditorState {
  template: Template;
  data: unknown;
  dataText: string;
  dataError: string | null;
  selection: Selection;
  zoom: number;
  past: Template[];
  future: Template[];
}

export type Action =
  | { type: 'load'; template: Template; data: unknown }
  | { type: 'setTemplate'; template: Template; coalesce?: boolean }
  | { type: 'setDataText'; text: string }
  | { type: 'select'; selection: Selection }
  | { type: 'zoom'; zoom: number }
  | { type: 'undo' }
  | { type: 'redo' };

const HISTORY_LIMIT = 100;

export function reducer(state: EditorState, action: Action): EditorState {
  switch (action.type) {
    case 'load':
      return {
        ...state,
        template: action.template,
        data: action.data,
        dataText: JSON.stringify(action.data, null, 2),
        dataError: null,
        selection: null,
        past: [],
        future: [],
      };

    case 'setTemplate': {
      // Dragging fires per pointermove; coalescing keeps one undo step per gesture.
      const past = action.coalesce && state.past.length > 0 ? state.past : [...state.past, state.template].slice(-HISTORY_LIMIT);
      return { ...state, template: action.template, past, future: [] };
    }

    case 'setDataText': {
      try {
        return { ...state, dataText: action.text, data: JSON.parse(action.text), dataError: null };
      } catch (err) {
        return { ...state, dataText: action.text, dataError: err instanceof Error ? err.message : String(err) };
      }
    }

    case 'select':
      return { ...state, selection: action.selection };

    case 'zoom':
      return { ...state, zoom: Math.min(4, Math.max(0.15, action.zoom)) };

    case 'undo': {
      const previous = state.past.at(-1);
      if (!previous) return state;
      return { ...state, template: previous, past: state.past.slice(0, -1), future: [state.template, ...state.future] };
    }

    case 'redo': {
      const next = state.future[0];
      if (!next) return state;
      return { ...state, template: next, past: [...state.past, state.template], future: state.future.slice(1) };
    }
  }
}

/* ── Template edits ──────────────────────────────────────────── */

export function layerItems(template: Template, layer: LayerName): Placed[] {
  return layer === 'overlay' ? template.overlay : template[layer].items;
}

export function withLayerItems(template: Template, layer: LayerName, items: Placed[]): Template {
  if (layer === 'overlay') return { ...template, overlay: items };
  return { ...template, [layer]: { ...template[layer], items } };
}

export function updatePlaced(template: Template, layer: LayerName, index: number, patch: (item: Placed) => Placed): Template {
  const items = layerItems(template, layer).map((item, i) => (i === index ? patch(item) : item));
  return withLayerItems(template, layer, items);
}

export function removePlaced(template: Template, layer: LayerName, index: number): Template {
  return withLayerItems(
    template,
    layer,
    layerItems(template, layer).filter((_, i) => i !== index),
  );
}

export function mergeNodeStyle(node: Node, patch: Style): Node {
  const style = { ...node.style, ...patch };
  for (const [k, v] of Object.entries(patch)) if (v === undefined || v === '') delete (style as Record<string, unknown>)[k];
  return { ...node, style } as Node;
}

/**
 * A placed item's y is relative to its band, not the page: header items start
 * at the top margin, footer items at the top of the footer band. The canvas
 * needs the page-absolute offset to draw handles in the right spot.
 */
export function layerOffsetY(template: Template, layer: LayerName): number {
  const { height } = pageSize(template.page);
  if (layer === 'header') return template.page.margin.top;
  if (layer === 'footer') return height - template.page.margin.bottom - template.footer.height;
  return 0;
}

let nodeSeq = 0;
export function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${(nodeSeq++).toString(36)}`;
}

export function blankNode(type: Node['type']): Node {
  const id = newId(type);
  switch (type) {
    case 'text':
      return { id, type: 'text', content: 'ข้อความใหม่ {{ }}', style: { fontSize: 10 } };
    case 'rect':
      return { id, type: 'rect', style: { background: '#e2e8f0', border: { all: { width: 0.3, style: 'solid', color: '#94a3b8' } } } };
    case 'line':
      return { id, type: 'line', orientation: 'horizontal', style: { border: { all: { width: 0.4, style: 'solid', color: '#334155' } } } };
    case 'image':
      return { id, type: 'image', src: '', fit: 'contain' };
    case 'barcode':
      return { id, type: 'barcode', format: 'qr', value: '{{ }}' };
    case 'pageNumber':
      return { id, type: 'pageNumber', format: 'หน้า {page} จาก {pages}', style: { fontSize: 9, color: '#6b7280' } };
    case 'stack':
      return { id, type: 'stack', direction: 'column', gap: 1, children: [] };
    case 'table':
      return {
        id,
        type: 'table',
        columns: [{ width: '1fr' }, { width: '1fr' }],
        head: [
          {
            id: newId('row'),
            cells: [
              { content: [{ id: newId('text'), type: 'text', content: 'หัวข้อ 1' }], style: { fontWeight: 700 } },
              { content: [{ id: newId('text'), type: 'text', content: 'หัวข้อ 2' }], style: { fontWeight: 700 } },
            ],
          },
        ],
        body: [
          {
            id: newId('row'),
            cells: [
              { content: [{ id: newId('text'), type: 'text', content: '{{ }}' }] },
              { content: [{ id: newId('text'), type: 'text', content: '{{ }}' }] },
            ],
          },
        ],
        foot: [],
        cellStyle: { fontSize: 9.5, padding: { top: 1.2, right: 2, bottom: 1.2, left: 2 }, border: { bottom: { width: 0.3, style: 'solid', color: '#e5e7eb' } } },
      };
  }
}

export const EMPTY_TEMPLATE: Template = {
  version: 1,
  name: 'เอกสารใหม่',
  page: { preset: 'A4', orientation: 'portrait', margin: { top: 15, right: 15, bottom: 15, left: 15 } },
  fonts: [],
  styles: {},
  defaultStyle: { fontFamily: 'Sarabun', fontSize: 10, color: '#111827', lineHeight: 1.4 },
  header: { height: 30, items: [] },
  footer: { height: 15, items: [] },
  overlay: [],
  body: [],
};
