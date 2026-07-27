import { useEffect, useMemo, useRef, useState } from 'react';
import { pageSize, type Placed, type Template } from '@pdftc/schema';
import { renderHtml } from '@pdftc/renderer';
import { BUILTIN_FONTS } from '@pdftc/fonts/list';
import { layerItems, layerOffsetY, updatePlaced, type Action, type LayerName, type Selection } from './state';

const MM_PER_PX = 25.4 / 96;
const PX_PER_MM = 96 / 25.4;
const LAYERS: LayerName[] = ['header', 'overlay', 'footer'];

type DragMode = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

/** Numbered ruler stops, thinned out until the labels stop colliding. The
 *  gradient keeps drawing 5mm and 10mm ticks either way. */
function ticks(lengthMm: number, scale: number): number[] {
  const stepMm = [10, 20, 50, 100].find((step) => step * scale >= 30) ?? 100;
  const out: number[] = [];
  for (let mm = 0; mm <= lengthMm - stepMm / 2; mm += stepMm) out.push(mm);
  return out;
}

interface Props {
  template: Template;
  data: unknown;
  zoom: number;
  selection: Selection;
  dispatch: (action: Action) => void;
}

/** The studio previews through the same emitter the PDF is printed from, so
 *  what is dragged here is literally what Chromium lays out. */
function useLiveHtml(template: Template, data: unknown): string {
  const [html, setHtml] = useState('');
  useEffect(() => {
    const id = setTimeout(() => {
      try {
        const withFonts: Template = { ...template, fonts: [...BUILTIN_FONTS, ...template.fonts] };
        setHtml(
          renderHtml(withFonts, data, {
            screenChrome: false,
            fontResolver: (src) => (/^(data|https?):/.test(src) ? src : `${location.origin}/fonts/${src}`),
          }),
        );
      } catch (err) {
        setHtml(`<pre style="color:#b91c1c;font:12px monospace;padding:16px">${String(err)}</pre>`);
      }
    }, 120);
    return () => clearTimeout(id);
  }, [template, data]);
  return html;
}

export function Canvas({ template, data, zoom, selection, dispatch }: Props) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [pageCount, setPageCount] = useState(1);
  const html = useLiveHtml(template, data);
  const { width: pageW, height: pageH } = pageSize(template.page);

  // The paginator sets the page count once it finishes; poll for it because
  // srcdoc has no reliable "done" event beyond load.
  useEffect(() => {
    let cancelled = false;
    const id = setInterval(() => {
      const doc = frameRef.current?.contentDocument;
      const value = doc?.documentElement.getAttribute('data-pdftc-pages');
      if (value && !cancelled) setPageCount(Math.max(1, Number(value)));
    }, 150);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [html]);

  const drag = useRef<{ mode: DragMode; layer: LayerName; index: number; start: Placed['frame']; x: number; y: number; moved: boolean } | null>(null);

  function onPointerDown(e: React.PointerEvent, mode: DragMode, layer: LayerName, index: number, item: Placed) {
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dispatch({ type: 'select', selection: { kind: 'placed', layer, index } });
    drag.current = { mode, layer, index, start: { ...item.frame }, x: e.clientX, y: e.clientY, moved: false };
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const scale = PX_PER_MM * zoom;
    // Alt disables the 0.5mm grid for fine placement.
    const snap = (v: number) => (e.altKey ? Math.round(v * 100) / 100 : Math.round(v * 2) / 2);
    const dx = (e.clientX - d.x) / scale;
    const dy = (e.clientY - d.y) / scale;
    const s = d.start;
    const h = s.h ?? 10;
    let frame = { ...s };

    if (d.mode === 'move') frame = { ...s, x: snap(s.x + dx), y: snap(s.y + dy) };
    else {
      if (d.mode.includes('e')) frame.w = Math.max(2, snap(s.w + dx));
      if (d.mode.includes('w')) {
        frame.x = snap(s.x + dx);
        frame.w = Math.max(2, snap(s.w - dx));
      }
      if (d.mode.includes('s')) frame.h = Math.max(2, snap(h + dy));
      if (d.mode.includes('n')) {
        frame.y = snap(s.y + dy);
        frame.h = Math.max(2, snap(h - dy));
      }
    }

    dispatch({
      type: 'setTemplate',
      template: updatePlaced(template, d.layer, d.index, (item) => ({ ...item, frame })),
      coalesce: d.moved,
    });
    d.moved = true;
  }

  function onPointerUp() {
    drag.current = null;
  }

  const overlays = useMemo(
    () =>
      LAYERS.flatMap((layer) => {
        const offset = layerOffsetY(template, layer);
        return layerItems(template, layer).map((item, index) => ({ layer, index, item, top: item.frame.y + offset }));
      }),
    [template],
  );

  const scale = PX_PER_MM * zoom;

  // The selected frame, projected onto the rulers so its extent can be read
  // off the scale rather than inferred from the inspector.
  const marked = selection?.kind === 'placed' ? overlays.find((o) => o.layer === selection.layer && o.index === selection.index) : undefined;

  const bodyTop = template.page.margin.top + template.header.height;
  const bodyHeight = pageH - bodyTop - template.page.margin.bottom - template.footer.height;

  return (
    <div className="canvas-scroll">
      <div
        className="canvas-stage"
        style={{ width: pageW * scale, height: pageH * pageCount * scale, ['--mm' as string]: `${scale}px` }}
      >
        <span className="ruler-corner">mm</span>

        <div className="ruler ruler-h">
          {ticks(pageW, scale).map((mm) => (
            <i key={mm} style={{ left: mm * scale }}>
              {mm}
            </i>
          ))}
          {marked && <span className="extent extent-h" style={{ left: marked.item.frame.x * scale, width: marked.item.frame.w * scale }} />}
        </div>

        {/* One vertical ruler per page: a frame's y is measured from the top of
            its own page, so a scale running the whole stack would lie. */}
        {Array.from({ length: pageCount }, (_, page) => (
          <div key={page} className="ruler ruler-v" style={{ top: page * pageH * scale, height: pageH * scale }}>
            {ticks(pageH, scale).map((mm) => (
              <i key={mm} style={{ top: mm * scale }}>
                {mm}
              </i>
            ))}
            {/* Only page 1 carries handles, so only page 1 shows the mark. */}
            {page === 0 && marked && (
              <span className="extent extent-v" style={{ top: marked.top * scale, height: (marked.item.frame.h ?? 6) * scale }} />
            )}
          </div>
        ))}

        <div className="body-bracket" style={{ top: bodyTop * scale, height: bodyHeight * scale }}>
          <span>body</span>
        </div>

        {Array.from({ length: pageCount - 1 }, (_, i) => (
          <div key={i} className="page-cut" style={{ top: (i + 1) * pageH * scale }}>
            <span>หน้า {i + 2}</span>
          </div>
        ))}

        <iframe
          ref={frameRef}
          title="preview"
          srcDoc={html}
          className="canvas-frame"
          style={{
            width: pageW * PX_PER_MM,
            height: pageH * pageCount * PX_PER_MM,
            transform: `scale(${zoom})`,
          }}
        />
        {/* Handles live outside the iframe so pointer events are not swallowed
            by the previewed document. Only page 1 is editable — the layers are
            masters that the paginator stamps onto every page. */}
        <div
          className="canvas-handles"
          style={{ width: pageW * scale, height: pageH * scale }}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerDown={() => dispatch({ type: 'select', selection: null })}
        >
          <div
            className="guide-region"
            style={{
              left: template.page.margin.left * scale,
              top: (template.page.margin.top + template.header.height) * scale,
              width: (pageW - template.page.margin.left - template.page.margin.right) * scale,
              height: (pageH - template.page.margin.top - template.header.height - template.page.margin.bottom - template.footer.height) * scale,
            }}
          />

          {overlays.map(({ layer, index, item, top }) => {
            const active = selection?.kind === 'placed' && selection.layer === layer && selection.index === index;
            return (
              <div
                key={`${layer}-${index}`}
                className={`handle-box${active ? ' is-active' : ''} layer-${layer}`}
                style={{
                  left: item.frame.x * scale,
                  top: top * scale,
                  width: item.frame.w * scale,
                  height: (item.frame.h ?? 6) * scale,
                }}
                onPointerDown={(e) => onPointerDown(e, 'move', layer, index, item)}
              >
                <span className="handle-tag">
                  <b>{item.node.name ?? item.node.id}</b>
                  {/* Position is read off the ruler; the tag only has to carry
                      what the ruler cannot show at a glance. */}
                  <span className="readout">
                    {round(item.frame.w)}×{round(item.frame.h ?? 6)}
                  </span>
                </span>
                {active &&
                  (['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se'] as DragMode[]).map((mode) => (
                    <i
                      key={mode}
                      className={`grip grip-${mode}`}
                      onPointerDown={(e) => onPointerDown(e, mode, layer, index, item)}
                    />
                  ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Frame values carry at most two decimals; trailing zeros are noise in a tag. */
function round(mm: number): string {
  return String(Math.round(mm * 100) / 100);
}

export { MM_PER_PX, PX_PER_MM };
