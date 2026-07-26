/**
 * The library controls in the toolbar: which stored template is open, and the
 * saves that put it back. Everything here goes through `library.ts`.
 *
 * The logic lives in a hook rather than the component because `App` binds the
 * same save to Ctrl+S, and a save that behaves differently depending on whether
 * it came from the keyboard or the button is a bug waiting to happen.
 */
import { useCallback, useEffect, useState, type Dispatch } from 'react';
import {
  createTemplate,
  deleteTemplate,
  duplicateTemplate,
  getTemplate,
  listTemplates,
  saveTemplate,
  StaleError,
  type TemplateSummary,
} from './library';
import type { Action, EditorState } from './state';

export interface Library {
  items: TemplateSummary[];
  busy: boolean;
  save: () => Promise<void>;
  saveAs: () => Promise<void>;
  open: (id: string) => Promise<void>;
  rename: () => Promise<void>;
  duplicate: () => Promise<void>;
  remove: () => Promise<void>;
}

export function useLibrary(state: EditorState, dispatch: Dispatch<Action>): Library {
  const [items, setItems] = useState<TemplateSummary[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setItems(await listTemplates().catch(() => []));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** One place to show a failure, so no path can fail silently. */
  const run = useCallback(async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, []);

  const create = useCallback(
    async (name: string) => {
      const record = await createTemplate({ name, template: state.template, data: state.data });
      dispatch({ type: 'saved', doc: record });
      await refresh();
    },
    [dispatch, refresh, state.data, state.template],
  );

  const saveAs = useCallback(async () => {
    const name = prompt('บันทึกเป็นชื่อ', state.doc ? `${state.doc.name} (สำเนา)` : state.template.name)?.trim();
    if (!name) return;
    await run(() => create(name));
  }, [create, run, state.doc, state.template.name]);

  const save = useCallback(async () => {
    const doc = state.doc;
    if (!doc) return saveAs();
    await run(async () => {
      try {
        const record = await saveTemplate(doc.id, { rev: doc.rev, name: doc.name, template: state.template, data: state.data });
        dispatch({ type: 'saved', doc: record });
      } catch (err) {
        if (!(err instanceof StaleError)) throw err;
        // Neither copy is obviously right, so the person who is here decides.
        // Declining leaves the edits in the tab — nothing is thrown away by us.
        const overwrite = confirm(`${err.message}\n\nตกลง = เขียนทับฉบับบนเซิร์ฟเวอร์\nยกเลิก = เก็บงานไว้ในแท็บนี้ก่อน (ส่งออกไว้ได้)`);
        if (!overwrite) return;
        const record = await saveTemplate(doc.id, { rev: err.rev, name: doc.name, template: state.template, data: state.data });
        dispatch({ type: 'saved', doc: record });
      }
      await refresh();
    });
  }, [dispatch, refresh, run, saveAs, state.data, state.doc, state.template]);

  const open = useCallback(
    async (id: string) => {
      if (!id || id === state.doc?.id) return;
      if (state.dirty && !confirm('งานที่ยังไม่บันทึกจะหาย เปิดเทมเพลตอื่นเลยไหม?')) return;
      await run(async () => {
        const record = await getTemplate(id);
        dispatch({ type: 'load', template: record.template, data: record.data, doc: record });
      });
    },
    [dispatch, run, state.dirty, state.doc?.id],
  );

  const rename = useCallback(async () => {
    const doc = state.doc;
    if (!doc) return;
    const name = prompt('ชื่อเทมเพลต', doc.name)?.trim();
    if (!name || name === doc.name) return;
    await run(async () => {
      const record = await saveTemplate(doc.id, { rev: doc.rev, name });
      dispatch({ type: 'renamed', doc: record });
      await refresh();
    });
  }, [dispatch, refresh, run, state.doc]);

  const duplicate = useCallback(async () => {
    const doc = state.doc;
    if (!doc) return;
    await run(async () => {
      const record = await duplicateTemplate(doc.id);
      dispatch({ type: 'load', template: record.template, data: record.data, doc: record });
      await refresh();
    });
  }, [dispatch, refresh, run, state.doc]);

  const remove = useCallback(async () => {
    const doc = state.doc;
    if (!doc || !confirm(`ลบ “${doc.name}” ถาวรไหม?`)) return;
    await run(async () => {
      await deleteTemplate(doc.id);
      // What is on screen stays: deleting the stored copy should not also wipe
      // the document the person is looking at.
      dispatch({ type: 'detach' });
      await refresh();
    });
  }, [dispatch, refresh, run, state.doc]);

  return { items, busy, save, saveAs, open, rename, duplicate, remove };
}

export function TemplateBar({ state, lib }: { state: EditorState; lib: Library }) {
  const { doc, dirty } = state;
  return (
    <div className="tool-group library">
      <select value={doc?.id ?? ''} onChange={(e) => void lib.open(e.target.value)} title="เทมเพลตที่บันทึกไว้">
        <option value="">{doc ? doc.name : '— ยังไม่ได้บันทึก —'}</option>
        {lib.items
          .filter((item) => item.id !== doc?.id)
          .map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
      </select>

      <button type="button" onClick={() => void lib.save()} disabled={lib.busy || (!dirty && doc !== null)}>
        {dirty || !doc ? 'บันทึก •' : 'บันทึกแล้ว'}
      </button>
      <button type="button" onClick={() => void lib.saveAs()} disabled={lib.busy}>
        บันทึกเป็น
      </button>
      <button type="button" onClick={() => void lib.rename()} disabled={lib.busy || !doc} title="เปลี่ยนชื่อ">
        ✎
      </button>
      <button type="button" onClick={() => void lib.duplicate()} disabled={lib.busy || !doc} title="ทำสำเนา">
        ⧉
      </button>
      <button type="button" className="danger" onClick={() => void lib.remove()} disabled={lib.busy || !doc} title="ลบ">
        ✕
      </button>
    </div>
  );
}
