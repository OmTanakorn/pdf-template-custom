import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { pageSize, type Template } from '@pdftc/schema';
import { renderHtml } from '@pdftc/renderer';
import { BUILTIN_FONTS, dataUriResolver, fileUrlResolver } from '@pdftc/fonts';

export interface RenderOptions {
  /** Inline font bytes into the HTML. Slower, but the HTML is portable. */
  embedFonts?: boolean;
  /** Add the template's font pack to the built-in Sarabun/Noto set. */
  extraFonts?: Template['fonts'];
  /** Milliseconds to wait for pagination to finish. */
  timeout?: number;
  /** Emit `<title>`-driven PDF metadata and tagged output. */
  tagged?: boolean;
}

export interface PdfRendererOptions {
  /**
   * Idle pages kept warm between renders. Should be at least the service's
   * render concurrency, or pages are closed and rebuilt on every request.
   */
  poolSize?: number;
  /**
   * Renders a page serves before it is closed and rebuilt.
   *
   * Blanking a page does not hand its memory back: Chromium keeps the renderer
   * process and its heap only grows. Measured on the invoice example at
   * concurrency 4, resident memory after the load settled:
   *
   *   no pool (a context per render)   ~350MB, 1.88s per 60 renders
   *   pool, unbounded reuse            ~2.0GB, 1.04s
   *   pool, `maxPageUses: 5`           ~712MB flat over 420 renders, 1.09s
   *
   * So the default keeps nearly all of the speed and trades a page rebuild
   * every five renders for a ceiling on the heap.
   */
  maxPageUses?: number;
}

/** Fixed across renders so output stays byte-comparable between machines. */
const CONTEXT_OPTIONS = {
  viewport: { width: 1240, height: 1754 },
  deviceScaleFactor: 2,
  locale: 'th-TH',
  timezoneId: 'Asia/Bangkok',
} as const;

/**
 * Reuses one Chromium across renders. Launching costs ~300ms, so a long-lived
 * process should hold the pool open rather than pay it per document.
 *
 * Pages are pooled inside a single shared context too: building a context and
 * page per document costs ~55ms of the ~125ms render and re-fetches every font,
 * because an HTTP cache does not outlive the context that owns it.
 */
export class PdfRenderer {
  private browser: Browser | null = null;
  private starting: Promise<Browser> | null = null;
  private context: BrowserContext | null = null;
  private opening: Promise<BrowserContext> | null = null;
  private readonly idle: Page[] = [];
  /** Renders each live page has served, so worn pages can be retired. */
  private readonly uses = new WeakMap<Page, number>();
  private readonly poolSize: number;
  private readonly maxPageUses: number;

  constructor(opts: PdfRendererOptions = {}) {
    this.poolSize = Math.max(1, opts.poolSize ?? 4);
    this.maxPageUses = Math.max(1, opts.maxPageUses ?? 5);
  }

  async launch(): Promise<Browser> {
    if (this.browser?.isConnected()) return this.browser;
    this.starting ??= chromium
      .launch({ args: ['--font-render-hinting=none', '--disable-lcd-text'] })
      .then((b) => {
        this.browser = b;
        this.starting = null;
        return b;
      });
    return this.starting;
  }

  async close(): Promise<void> {
    this.idle.length = 0; // closing the browser closes them
    this.context = null;
    await this.browser?.close();
    this.browser = null;
  }

  /** The shared context every pooled page lives in. */
  private async sharedContext(): Promise<BrowserContext> {
    if (this.context && this.browser?.isConnected()) return this.context;
    this.opening ??= this.launch()
      .then((browser) => browser.newContext(CONTEXT_OPTIONS))
      .then((ctx) => {
        this.context = ctx;
        this.opening = null;
        return ctx;
      });
    return this.opening;
  }

  private async acquire(): Promise<Page> {
    for (let page = this.idle.pop(); page; page = this.idle.pop()) {
      if (!page.isClosed()) {
        this.uses.set(page, (this.uses.get(page) ?? 0) + 1);
        return page;
      }
    }
    const page = await (await this.sharedContext()).newPage();
    this.uses.set(page, 1);
    return page;
  }

  /**
   * `healthy` is false when the render threw: a page that timed out mid-paginate
   * may still be running scripts, so it is discarded rather than reused.
   */
  private async release(page: Page, healthy: boolean): Promise<void> {
    const worn = (this.uses.get(page) ?? 0) >= this.maxPageUses;
    if (!healthy || worn || page.isClosed() || this.idle.length >= this.poolSize) {
      await page.close().catch(() => {});
      return;
    }
    try {
      // Drop the document so an idle page does not hold a rendered one in memory.
      await page.setContent('<!doctype html><title>idle</title>');
      this.idle.push(page);
    } catch {
      await page.close().catch(() => {});
    }
  }

  /** Template + data → PDF bytes. */
  async render(template: Template, data: unknown, opts: RenderOptions = {}): Promise<Uint8Array> {
    const html = this.toHtml(template, data, opts);
    const page = await this.acquire();
    let healthy = false;
    try {
      await page.setContent(html, { waitUntil: 'load' });
      await page.waitForFunction(() => document.documentElement.getAttribute('data-pdftc-ready') === '1', undefined, {
        timeout: opts.timeout ?? 30_000,
      });
      const { width, height } = pageSize(template.page);
      const pdf = await page.pdf({
        width: `${width}mm`,
        height: `${height}mm`,
        printBackground: true,
        margin: { top: '0', right: '0', bottom: '0', left: '0' },
        preferCSSPageSize: true,
        tagged: opts.tagged ?? false,
      });
      healthy = true;
      return pdf;
    } finally {
      await this.release(page, healthy);
    }
  }

  /** The intermediate HTML, exposed for debugging and for the studio preview. */
  toHtml(template: Template, data: unknown, opts: RenderOptions = {}): string {
    const withFonts: Template = {
      ...template,
      fonts: [...BUILTIN_FONTS, ...(opts.extraFonts ?? []), ...template.fonts],
    };
    return renderHtml(withFonts, data, {
      fontResolver: opts.embedFonts ? dataUriResolver : fileUrlResolver,
    });
  }
}

/** One-shot render. Prefer a long-lived `PdfRenderer` for repeated calls. */
export async function renderPdf(template: Template, data: unknown, opts: RenderOptions = {}): Promise<Uint8Array> {
  const renderer = new PdfRenderer();
  try {
    return await renderer.render(template, data, opts);
  } finally {
    await renderer.close();
  }
}
