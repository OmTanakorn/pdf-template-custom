import type { FontFace } from '@pdftc/schema';

/**
 * Fonts shipped with the renderer. Sarabun is the Thai government standard
 * face and covers Latin too, so a document can stay on one family.
 *
 * Split from `index.ts` because the studio imports this list in the browser,
 * where `node:fs` is not available.
 */
export const BUILTIN_FONTS: FontFace[] = [
  { family: 'Sarabun', weight: 400, italic: false, src: 'Sarabun-Regular.ttf' },
  { family: 'Sarabun', weight: 500, italic: false, src: 'Sarabun-Medium.ttf' },
  { family: 'Sarabun', weight: 600, italic: false, src: 'Sarabun-SemiBold.ttf' },
  { family: 'Sarabun', weight: 700, italic: false, src: 'Sarabun-Bold.ttf' },
  { family: 'Noto Sans Thai', weight: 300, italic: false, src: 'NotoSansThai-Light.ttf' },
  { family: 'Noto Sans Thai', weight: 400, italic: false, src: 'NotoSansThai-Regular.ttf' },
  { family: 'Noto Sans Thai', weight: 500, italic: false, src: 'NotoSansThai-Medium.ttf' },
  { family: 'Noto Sans Thai', weight: 700, italic: false, src: 'NotoSansThai-Bold.ttf' },
];

export const FONT_FAMILIES = ['Sarabun', 'Noto Sans Thai'] as const;
