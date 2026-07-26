import type { FontFace } from '@pdftc/schema';

/**
 * Fonts shipped with the renderer, all from Google Fonts under the OFL
 * (licences in `packages/fonts/licenses/`).
 *
 * Split from `index.ts` because the studio imports this list in the browser,
 * where `node:fs` is not available.
 *
 * Families with a variable file ship one `-VF.ttf` covering the whole weight
 * axis; the rest ship regular and bold only, to keep the pack near 3MB. The
 * emitter declares `@font-face` only for families a template actually uses, so
 * pack size does not land in every rendered document.
 */
export const BUILTIN_FONTS: FontFace[] = [
  // Sarabun is the Thai government standard face and the default here.
  { family: 'Sarabun', weight: 400, italic: false, src: 'Sarabun-Regular.ttf' },
  { family: 'Sarabun', weight: 500, italic: false, src: 'Sarabun-Medium.ttf' },
  { family: 'Sarabun', weight: 600, italic: false, src: 'Sarabun-SemiBold.ttf' },
  { family: 'Sarabun', weight: 700, italic: false, src: 'Sarabun-Bold.ttf' },

  { family: 'Noto Sans Thai', weight: 400, weightRange: [100, 900], italic: false, src: 'NotoSansThai-VF.ttf' },
  { family: 'Noto Serif Thai', weight: 400, weightRange: [100, 900], italic: false, src: 'NotoSerifThai-VF.ttf' },
  { family: 'Anuphan', weight: 400, weightRange: [100, 700], italic: false, src: 'Anuphan-VF.ttf' },

  { family: 'IBM Plex Sans Thai', weight: 400, italic: false, src: 'IBMPlexSansThai-Regular.ttf' },
  { family: 'IBM Plex Sans Thai', weight: 700, italic: false, src: 'IBMPlexSansThai-Bold.ttf' },

  { family: 'Kanit', weight: 400, italic: false, src: 'Kanit-Regular.ttf' },
  { family: 'Kanit', weight: 700, italic: false, src: 'Kanit-Bold.ttf' },

  { family: 'Prompt', weight: 400, italic: false, src: 'Prompt-Regular.ttf' },
  { family: 'Prompt', weight: 700, italic: false, src: 'Prompt-Bold.ttf' },

  { family: 'Trirong', weight: 400, italic: false, src: 'Trirong-Regular.ttf' },
  { family: 'Trirong', weight: 700, italic: false, src: 'Trirong-Bold.ttf' },

  { family: 'Chakra Petch', weight: 400, italic: false, src: 'ChakraPetch-Regular.ttf' },
  { family: 'Chakra Petch', weight: 700, italic: false, src: 'ChakraPetch-Bold.ttf' },

  { family: 'Charm', weight: 400, italic: false, src: 'Charm-Regular.ttf' },
  { family: 'Charm', weight: 700, italic: false, src: 'Charm-Bold.ttf' },
];

/** Grouped for the studio's font picker. */
export const FONT_GROUPS: { label: string; families: string[] }[] = [
  { label: 'Sans', families: ['Sarabun', 'Noto Sans Thai', 'IBM Plex Sans Thai', 'Anuphan', 'Prompt', 'Kanit'] },
  { label: 'Serif', families: ['Noto Serif Thai', 'Trirong'] },
  { label: 'Display', families: ['Chakra Petch', 'Charm'] },
];

export const FONT_FAMILIES = FONT_GROUPS.flatMap((g) => g.families);

/**
 * Appended to every font stack so a glyph missing from the chosen family still
 * renders. Their `@font-face` rules are always emitted for the same reason.
 */
export const FALLBACK_FAMILIES = ['Noto Sans Thai', 'Sarabun'];
