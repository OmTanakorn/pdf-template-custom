/**
 * Binding resolution: Template + data → a template with every expression
 * already evaluated. `each` loops are expanded, `visibleIf` nodes are
 * dropped, and `{{ … }}` in text becomes literal text.
 *
 * Kept separate from the HTML emitter so the emitter stays a pure
 * structure-to-markup function that both the studio and the server run.
 */

import type { Cell, Node, Placed, Row, StackNode, TableNode, Template } from '@pdftc/schema';
import { evaluate, evaluateBool, interpolate } from './expr.js';
import type { Scope } from './expr.js';

let counter = 0;
/** Loop expansion clones ids; suffix them so they stay unique in the DOM. */
function uid(base: string): string {
  return `${base}__${(counter++).toString(36)}`;
}

function child(scope: Scope, each: { in: string; as: string; indexAs?: string }, item: unknown, index: number): Scope {
  const next: Scope = Object.create(scope) as Scope;
  next[each.as] = item;
  if (each.indexAs) next[each.indexAs] = index;
  next['$index'] = index;
  return next;
}

function toArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (v == null) return [];
  return [v];
}

export function resolveNode(node: Node, scope: Scope): Node[] {
  if (!evaluateBool(node.visibleIf, scope)) return [];

  switch (node.type) {
    case 'text':
      return [{ ...node, id: uid(node.id), content: interpolate(node.content, scope) }];

    case 'image':
      return [{ ...node, id: uid(node.id), src: interpolate(node.src, scope) }];

    case 'barcode':
      return [{ ...node, id: uid(node.id), value: interpolate(node.value, scope) }];

    case 'rect':
    case 'line':
    case 'pageNumber':
      return [{ ...node, id: uid(node.id) }];

    case 'stack':
      return resolveStack(node, scope);

    case 'table':
      return [resolveTable(node, scope)];
  }
}

function resolveStack(node: StackNode, scope: Scope): Node[] {
  if (!node.each) {
    return [{ ...node, id: uid(node.id), children: node.children.flatMap((c) => resolveNode(c, scope)) }];
  }
  const items = toArray(evaluate(node.each.in, scope));
  return items.map((item, i) => {
    const inner = child(scope, node.each!, item, i);
    const { each: _drop, ...rest } = node;
    return { ...rest, id: uid(node.id), children: node.children.flatMap((c) => resolveNode(c, inner)) } satisfies StackNode;
  });
}

function resolveCell(cell: Cell, scope: Scope): Cell {
  return { ...cell, content: cell.content.flatMap((n) => resolveNode(n, scope)) };
}

function resolveRows(rows: Row[], scope: Scope): Row[] {
  const out: Row[] = [];
  for (const row of rows) {
    if (!row.each) {
      out.push({ ...row, id: uid(row.id), cells: row.cells.map((c) => resolveCell(c, scope)) });
      continue;
    }
    const items = toArray(evaluate(row.each.in, scope));
    items.forEach((item, i) => {
      const inner = child(scope, row.each!, item, i);
      const { each: _drop, ...rest } = row;
      out.push({ ...rest, id: uid(row.id), cells: row.cells.map((c) => resolveCell(c, inner)) });
    });
  }
  return out;
}

function resolveTable(node: TableNode, scope: Scope): TableNode {
  return {
    ...node,
    id: uid(node.id),
    head: resolveRows(node.head, scope),
    body: resolveRows(node.body, scope),
    foot: resolveRows(node.foot, scope),
  };
}

function resolvePlaced(items: Placed[], scope: Scope): Placed[] {
  return items.flatMap((item) => {
    const nodes = resolveNode(item.node, scope);
    return nodes.map((node) => ({ ...item, node }));
  });
}

/** Returns a template whose content is fully data-bound and ready to emit. */
export function resolveTemplate(template: Template, data: unknown): Template {
  counter = 0;
  const scope: Scope = { ...(data && typeof data === 'object' ? (data as Scope) : {}), $data: data };
  return {
    ...template,
    header: { ...template.header, items: resolvePlaced(template.header.items, scope) },
    footer: { ...template.footer, items: resolvePlaced(template.footer.items, scope) },
    overlay: resolvePlaced(template.overlay, scope),
    body: template.body.flatMap((n) => resolveNode(n, scope)),
  };
}
