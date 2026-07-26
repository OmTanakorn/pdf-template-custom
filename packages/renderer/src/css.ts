import type { Border, Box, Style } from '@pdftc/schema';

export function mm(v: number): string {
  // Six decimals keeps sub-micron precision without bloating the markup.
  return `${Number(v.toFixed(6))}mm`;
}

export function pt(v: number): string {
  return `${Number(v.toFixed(4))}pt`;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function escapeAttr(s: string): string {
  return escapeHtml(s);
}

function boxToCss(prop: string, box: Box): string[] {
  return [`${prop}:${mm(box.top)} ${mm(box.right)} ${mm(box.bottom)} ${mm(box.left)}`];
}

function borderToCss(border: Border): string[] {
  const out: string[] = [];
  const side = (name: string, s: NonNullable<Border['top']>) => `border-${name}:${pt(s.width)} ${s.style} ${s.color}`;
  if (border.all) out.push(`border:${pt(border.all.width)} ${border.all.style} ${border.all.color}`);
  if (border.top) out.push(side('top', border.top));
  if (border.right) out.push(side('right', border.right));
  if (border.bottom) out.push(side('bottom', border.bottom));
  if (border.left) out.push(side('left', border.left));
  return out;
}

/** Merge styles left-to-right; later wins. `padding` and `border` merge deeply. */
export function mergeStyles(...styles: (Style | undefined)[]): Style {
  const out: Style = {};
  for (const s of styles) {
    if (!s) continue;
    for (const [k, v] of Object.entries(s)) {
      if (v === undefined) continue;
      if (k === 'border') out.border = { ...out.border, ...(v as Border) };
      else if (k === 'padding') out.padding = { ...out.padding, ...(v as Box) } as Box;
      else (out as Record<string, unknown>)[k] = v;
    }
  }
  return out;
}

const VALIGN_FLEX: Record<string, string> = { top: 'flex-start', middle: 'center', bottom: 'flex-end' };

export function styleToCss(s: Style, opts: { asFlex?: boolean } = {}): string {
  const out: string[] = [];
  if (s.fontFamily) out.push(`font-family:${cssFontStack(s.fontFamily)}`);
  if (s.fontSize != null) out.push(`font-size:${pt(s.fontSize)}`);
  if (s.fontWeight != null) out.push(`font-weight:${s.fontWeight}`);
  if (s.italic) out.push('font-style:italic');
  if (s.underline) out.push('text-decoration:underline');
  if (s.lineHeight != null) out.push(`line-height:${s.lineHeight}`);
  if (s.letterSpacing != null) out.push(`letter-spacing:${pt(s.letterSpacing)}`);
  if (s.color) out.push(`color:${s.color}`);
  if (s.background) out.push(`background:${s.background}`);
  if (s.align) out.push(`text-align:${s.align}`);
  if (s.padding) out.push(...boxToCss('padding', s.padding));
  if (s.border) out.push(...borderToCss(s.border));
  if (s.radius != null) out.push(`border-radius:${mm(s.radius)}`);
  if (s.opacity != null) out.push(`opacity:${s.opacity}`);
  if (s.whiteSpace) out.push(`white-space:${s.whiteSpace}`);
  if (s.valign) {
    // Vertical centring inside a fixed-height box only works with flex; table
    // cells use vertical-align instead and ignore this branch.
    if (opts.asFlex) out.push('display:flex', 'flex-direction:column', `justify-content:${VALIGN_FLEX[s.valign]}`);
    out.push(`vertical-align:${s.valign === 'middle' ? 'middle' : s.valign}`);
  }
  return out.join(';');
}

/** Always fall back to a Thai-capable family so missing glyphs never tofu. */
export function cssFontStack(family: string): string {
  const quoted = /^[A-Za-z0-9_-]+$/.test(family) ? family : `"${family.replace(/"/g, '')}"`;
  return `${quoted}, "Noto Sans Thai", "Sarabun", sans-serif`;
}
