export * from './expr.js';
export * from './resolve.js';
export * from './emit.js';
export * from './css.js';
export { PAGINATOR_SOURCE } from './paginator.js';

import type { Template } from '@pdftc/schema';
import { emitHtml, type EmitOptions } from './emit.js';
import { resolveTemplate } from './resolve.js';

/** Template + data → a complete, self-paginating HTML document. */
export function renderHtml(template: Template, data: unknown, opts: EmitOptions = {}): string {
  return emitHtml(resolveTemplate(template, data), opts);
}
