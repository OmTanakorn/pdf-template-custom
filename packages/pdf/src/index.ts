import { chromium, type Browser } from 'playwright';
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

/**
 * Reuses one Chromium across renders. Launching costs ~300ms, so a long-lived
 * process should hold the pool open rather than pay it per document.
 */
export class PdfRenderer {
  private browser: Browser | null = null;
  private starting: Promise<Browser> | null = null;

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
    await this.browser?.close();
    this.browser = null;
  }

  /** Template + data → PDF bytes. */
  async render(template: Template, data: unknown, opts: RenderOptions = {}): Promise<Uint8Array> {
    const html = this.toHtml(template, data, opts);
    const browser = await this.launch();
    const context = await browser.newContext({
      // Fixed viewport and locale keep renders byte-comparable across machines.
      viewport: { width: 1240, height: 1754 },
      deviceScaleFactor: 2,
      locale: 'th-TH',
      timezoneId: 'Asia/Bangkok',
    });
    const page = await context.newPage();
    try {
      await page.setContent(html, { waitUntil: 'load' });
      await page.waitForFunction(() => document.documentElement.getAttribute('data-pdftc-ready') === '1', undefined, {
        timeout: opts.timeout ?? 30_000,
      });
      const { width, height } = pageSize(template.page);
      return await page.pdf({
        width: `${width}mm`,
        height: `${height}mm`,
        printBackground: true,
        margin: { top: '0', right: '0', bottom: '0', left: '0' },
        preferCSSPageSize: true,
        tagged: opts.tagged ?? false,
      });
    } finally {
      await context.close();
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
