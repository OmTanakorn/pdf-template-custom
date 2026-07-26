import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, isAbsolute, resolve } from 'node:path';
export { BUILTIN_FONTS, FONT_FAMILIES } from './list.js';

const PACK_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Directory holding the shipped font files, for static serving. */
export const FONT_DIR = PACK_DIR;

function localPath(src: string): string {
  return isAbsolute(src) ? src : resolve(PACK_DIR, src);
}

/** `file://` URLs — fastest, but the HTML is only valid on this machine. */
export function fileUrlResolver(src: string): string {
  if (src.startsWith('data:') || src.startsWith('http:') || src.startsWith('https:')) return src;
  return pathToFileURL(localPath(src)).href;
}

const dataUriCache = new Map<string, string>();

/** Inlines the font bytes so the HTML renders anywhere, sandbox included. */
export function dataUriResolver(src: string): string {
  if (src.startsWith('data:') || src.startsWith('http:') || src.startsWith('https:')) return src;
  const path = localPath(src);
  const cached = dataUriCache.get(path);
  if (cached) return cached;
  const mime = path.endsWith('.otf') ? 'font/otf' : path.endsWith('.woff2') ? 'font/woff2' : 'font/ttf';
  const uri = `data:${mime};base64,${readFileSync(path).toString('base64')}`;
  dataUriCache.set(path, uri);
  return uri;
}
