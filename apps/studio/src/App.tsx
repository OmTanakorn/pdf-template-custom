import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { parseTemplate, type Template } from '@pdftc/schema';
import { Canvas } from './Canvas';
import { Inspector } from './Inspector';
import { Tree } from './Tree';
import { EMPTY_TEMPLATE, layerItems, reducer, updatePlaced, withLayerItems, type EditorState } from './state';

const initial: EditorState = {
  template: EMPTY_TEMPLATE,
  data: {},
  dataText: '{}',
  dataError: null,
  selection: { kind: 'page' },
  zoom: 0.9,
  past: [],
  future: [],
};

export function App() {
  const [state, dispatch] = useReducer(reducer, initial);
  const [tab, setTab] = useState<'design' | 'data' | 'json'>('design');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadExample = useCallback(async () => {
    const res = await fetch('/api/example');
    const { template, data } = await res.json();
    dispatch({ type: 'load', template: parseTemplate(template), data });
  }, []);

  useEffect(() => {
    void loadExample().catch(() => dispatch({ type: 'load', template: EMPTY_TEMPLATE, data: {} }));
  }, [loadExample]);

  // Keyboard: undo/redo, nudge, delete. Ignored while typing in a field.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        dispatch({ type: e.shiftKey ? 'redo' : 'undo' });
        return;
      }

      const sel = state.selection;
      if (!sel || sel.kind !== 'placed') return;

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        dispatch({
          type: 'setTemplate',
          template: withLayerItems(
            state.template,
            sel.layer,
            layerItems(state.template, sel.layer).filter((_, i) => i !== sel.index),
          ),
        });
        dispatch({ type: 'select', selection: null });
        return;
      }

      const step = e.shiftKey ? 5 : 0.5;
      const delta: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      };
      const move = delta[e.key];
      if (!move) return;
      e.preventDefault();
      dispatch({
        type: 'setTemplate',
        template: updatePlaced(state.template, sel.layer, sel.index, (item) => ({
          ...item,
          frame: { ...item.frame, x: item.frame.x + move[0], y: item.frame.y + move[1] },
        })),
      });
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state.selection, state.template]);

  async function renderPdf() {
    setBusy(true);
    try {
      const res = await fetch('/api/render', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ template: state.template, data: state.data }),
      });
      if (res.status === 503) {
        // The API sheds load rather than dying. Say so instead of showing a
        // bare error — the request is fine, the server is just saturated.
        const after = Number(res.headers.get('retry-after') ?? 5);
        throw new Error(`เซิร์ฟเวอร์กำลังเรนเดอร์งานอื่นอยู่ ลองใหม่ในอีก ${after} วินาที`);
      }
      if (!res.ok) throw new Error((await res.json()).error ?? res.statusText);
      const url = URL.createObjectURL(await res.blob());
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      alert(`เรนเดอร์ไม่สำเร็จ: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  function exportTemplate() {
    const blob = new Blob([JSON.stringify(state.template, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${state.template.name || 'template'}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function importTemplate(file: File) {
    try {
      dispatch({ type: 'setTemplate', template: parseTemplate(JSON.parse(await file.text())) });
    } catch (err) {
      alert(`เทมเพลตไม่ถูกต้อง: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return (
    <div className="app">
      <header className="toolbar">
        <strong className="brand">PDF Template Studio</strong>

        <div className="tool-group">
          <button type="button" onClick={() => dispatch({ type: 'undo' })} disabled={state.past.length === 0} title="Ctrl+Z">
            ↶
          </button>
          <button type="button" onClick={() => dispatch({ type: 'redo' })} disabled={state.future.length === 0} title="Ctrl+Shift+Z">
            ↷
          </button>
        </div>

        <div className="tool-group">
          <button type="button" onClick={() => dispatch({ type: 'zoom', zoom: state.zoom - 0.1 })}>−</button>
          <span className="zoom">{Math.round(state.zoom * 100)}%</span>
          <button type="button" onClick={() => dispatch({ type: 'zoom', zoom: state.zoom + 0.1 })}>+</button>
        </div>

        <nav className="tabs">
          {(['design', 'data', 'json'] as const).map((t) => (
            <button key={t} type="button" className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
              {t === 'design' ? 'ออกแบบ' : t === 'data' ? 'ข้อมูล' : 'JSON'}
            </button>
          ))}
        </nav>

        <div className="tool-group right">
          <button type="button" onClick={loadExample}>ตัวอย่าง</button>
          <button type="button" onClick={() => fileRef.current?.click()}>นำเข้า</button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void importTemplate(file);
              e.target.value = '';
            }}
          />
          <button type="button" onClick={exportTemplate}>ส่งออก</button>
          <button type="button" className="primary" onClick={renderPdf} disabled={busy}>
            {busy ? 'กำลังเรนเดอร์…' : 'เรนเดอร์ PDF'}
          </button>
        </div>
      </header>

      <div className="workspace">
        <aside className="left">
          <Tree template={state.template} selection={state.selection} dispatch={dispatch} />
        </aside>

        <main className="center">
          {tab === 'design' && (
            <Canvas template={state.template} data={state.data} zoom={state.zoom} selection={state.selection} dispatch={dispatch} />
          )}
          {tab === 'data' && (
            <div className="editor-pane">
              {state.dataError && <p className="error">JSON ไม่ถูกต้อง: {state.dataError}</p>}
              <textarea
                className="code"
                spellCheck={false}
                value={state.dataText}
                onChange={(e) => dispatch({ type: 'setDataText', text: e.target.value })}
              />
            </div>
          )}
          {tab === 'json' && (
            <div className="editor-pane">
              <TemplateJson template={state.template} onChange={(t) => dispatch({ type: 'setTemplate', template: t })} />
            </div>
          )}
        </main>

        <aside className="right">
          <Inspector template={state.template} selection={state.selection} dispatch={dispatch} />
        </aside>
      </div>
    </div>
  );
}

function TemplateJson({ template, onChange }: { template: Template; onChange: (t: Template) => void }) {
  const [text, setText] = useState(() => JSON.stringify(template, null, 2));
  const [error, setError] = useState<string | null>(null);
  const dirty = useRef(false);

  // Re-sync from the canvas only while the user is not mid-edit here.
  useEffect(() => {
    if (!dirty.current) setText(JSON.stringify(template, null, 2));
  }, [template]);

  return (
    <>
      {error && <p className="error">{error}</p>}
      <div className="pane-actions">
        <button
          type="button"
          className="primary"
          onClick={() => {
            try {
              onChange(parseTemplate(JSON.parse(text)));
              setError(null);
              dirty.current = false;
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err));
            }
          }}
        >
          ใช้ค่านี้
        </button>
      </div>
      <textarea
        className="code"
        spellCheck={false}
        value={text}
        onChange={(e) => {
          dirty.current = true;
          setText(e.target.value);
        }}
      />
    </>
  );
}
