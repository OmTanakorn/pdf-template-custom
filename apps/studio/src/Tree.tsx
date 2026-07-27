import { useState } from 'react';
import type { Node, Template } from '@pdftc/schema';
import { blankNode, layerItems, newId, renameStyleRefs, withLayerItems, type Action, type LayerName, type Selection } from './state';

const ADDABLE: { type: Node['type']; label: string }[] = [
  { type: 'text', label: 'ข้อความ' },
  { type: 'table', label: 'ตาราง' },
  { type: 'stack', label: 'กลุ่ม' },
  { type: 'rect', label: 'สี่เหลี่ยม' },
  { type: 'line', label: 'เส้น' },
  { type: 'image', label: 'รูป' },
  { type: 'barcode', label: 'บาร์โค้ด' },
  { type: 'pageNumber', label: 'เลขหน้า' },
];

interface Props {
  template: Template;
  selection: Selection;
  dispatch: (action: Action) => void;
}

export function Tree({ template, selection, dispatch }: Props) {
  const commit = (next: Template) => dispatch({ type: 'setTemplate', template: next });

  function addPlaced(layer: LayerName, type: Node['type']) {
    const items = layerItems(template, layer);
    // Stagger new items so two additions in a row do not stack invisibly.
    const y = 4 + items.length * 6;
    const next = withLayerItems(template, layer, [
      ...items,
      { frame: { x: template.page.margin.left, y, w: 60, h: type === 'line' ? 0 : 8, rotate: 0 }, node: blankNode(type), on: 'all' },
    ]);
    commit(next);
    dispatch({ type: 'select', selection: { kind: 'placed', layer, index: items.length } });
  }

  function addBody(type: Node['type']) {
    commit({ ...template, body: [...template.body, blankNode(type)] });
    dispatch({ type: 'select', selection: { kind: 'body', index: template.body.length } });
  }

  function move(layer: LayerName, index: number, delta: number) {
    const items = [...layerItems(template, layer)];
    const target = index + delta;
    if (target < 0 || target >= items.length) return;
    [items[index], items[target]] = [items[target]!, items[index]!];
    commit(withLayerItems(template, layer, items));
    dispatch({ type: 'select', selection: { kind: 'placed', layer, index: target } });
  }

  function moveBody(index: number, delta: number) {
    const body = [...template.body];
    const target = index + delta;
    if (target < 0 || target >= body.length) return;
    [body[index], body[target]] = [body[target]!, body[index]!];
    commit({ ...template, body });
    dispatch({ type: 'select', selection: { kind: 'body', index: target } });
  }

  return (
    <div className="tree">
      <button
        type="button"
        className={`tree-root${selection?.kind === 'page' || selection === null ? ' is-active' : ''}`}
        onClick={() => dispatch({ type: 'select', selection: { kind: 'page' } })}
      >
        <span className="sheet-mark" aria-hidden="true" />
        <span className="tree-root-name">{template.name}</span>
      </button>

      {(['header', 'overlay', 'footer'] as LayerName[]).map((layer) => (
        <section key={layer} className={`tree-group layer-${layer}`}>
          <header>
            <h4>{layer === 'header' ? 'หัวกระดาษ' : layer === 'footer' ? 'ท้ายกระดาษ' : 'ทับหน้า'}</h4>
            <AddMenu onPick={(type) => addPlaced(layer, type)} />
          </header>
          <ul>
            {layerItems(template, layer).map((item, index) => {
              const active = selection?.kind === 'placed' && selection.layer === layer && selection.index === index;
              return (
                <li key={`${item.node.id}-${index}`} className={active ? 'is-active' : ''}>
                  <button type="button" onClick={() => dispatch({ type: 'select', selection: { kind: 'placed', layer, index } })}>
                    <em className="mono">{item.node.type}</em>
                    <b>{item.node.name ?? preview(item.node)}</b>
                  </button>
                  <span className="reorder">
                    <button type="button" onClick={() => move(layer, index, -1)} title="ขึ้น">↑</button>
                    <button type="button" onClick={() => move(layer, index, 1)} title="ลง">↓</button>
                  </span>
                </li>
              );
            })}
            {layerItems(template, layer).length === 0 && <li className="empty">ว่าง</li>}
          </ul>
        </section>
      ))}

      <section className="tree-group layer-body">
        <header>
          <h4>เนื้อหา · ตัดหน้าเอง</h4>
          <AddMenu onPick={addBody} />
        </header>
        <ul>
          {template.body.map((node, index) => {
            const active = selection?.kind === 'body' && selection.index === index;
            return (
              <li key={`${node.id}-${index}`} className={active ? 'is-active' : ''}>
                <button type="button" onClick={() => dispatch({ type: 'select', selection: { kind: 'body', index } })}>
                  <em className="mono">{node.type}</em>
                  <b>{node.name ?? preview(node)}</b>
                </button>
                <span className="reorder">
                  <button type="button" onClick={() => moveBody(index, -1)} title="ขึ้น">↑</button>
                  <button type="button" onClick={() => moveBody(index, 1)} title="ลง">↓</button>
                </span>
              </li>
            );
          })}
          {template.body.length === 0 && <li className="empty">ว่าง</li>}
        </ul>
      </section>

      <StylesPanel template={template} selection={selection} commit={commit} dispatch={dispatch} />
    </div>
  );
}

function preview(node: Node): string {
  if (node.type === 'text') return node.content.slice(0, 28);
  if (node.type === 'table') return `${node.columns.length} คอลัมน์`;
  return node.id;
}

function AddMenu({ onPick }: { onPick: (type: Node['type']) => void }) {
  return (
    <select
      className="add-menu"
      value=""
      onChange={(e) => {
        if (e.target.value) onPick(e.target.value as Node['type']);
        e.target.value = '';
      }}
    >
      <option value="">+ เพิ่ม</option>
      {ADDABLE.map((a) => (
        <option key={a.type} value={a.type}>
          {a.label}
        </option>
      ))}
    </select>
  );
}

function StylesPanel({
  template,
  selection,
  commit,
  dispatch,
}: {
  template: Template;
  selection: Selection;
  commit: (t: Template) => void;
  dispatch: (action: Action) => void;
}) {
  const names = Object.keys(template.styles);
  const [error, setError] = useState<string | null>(null);

  function addStyle() {
    const name = newId('style');
    commit({ ...template, styles: { ...template.styles, [name]: { fontSize: 10 } } });
    dispatch({ type: 'select', selection: { kind: 'style', name } });
  }

  /** Returns false when the new name was rejected, so the input can snap back. */
  function renameStyle(name: string, input: string): boolean {
    const nextName = input.trim();
    const style = template.styles[name];
    if (style === undefined) return false;
    if (nextName === name) {
      setError(null);
      return true;
    }
    // A blank name would vanish from the picker and a taken one would clobber
    // another style — either way every styleRef pointing here loses its styling.
    if (nextName === '' || nextName in template.styles) {
      setError(nextName === '' ? 'ชื่อสไตล์ว่างไม่ได้' : `มีสไตล์ชื่อ "${nextName}" อยู่แล้ว`);
      return false;
    }
    setError(null);
    const styles = { ...template.styles };
    delete styles[name];
    styles[nextName] = style;
    commit(renameStyleRefs({ ...template, styles }, name, nextName));
    if (selection?.kind === 'style' && selection.name === name) {
      dispatch({ type: 'select', selection: { kind: 'style', name: nextName } });
    }
    return true;
  }

  function removeStyle(name: string) {
    const styles = { ...template.styles };
    delete styles[name];
    commit({ ...template, styles });
    if (selection?.kind === 'style' && selection.name === name) {
      dispatch({ type: 'select', selection: null });
    }
  }

  return (
    <section className="tree-group layer-body">
      <header>
        <h4>สไตล์ที่ตั้งชื่อไว้</h4>
        <button type="button" className="add-menu" onClick={addStyle}>
          + เพิ่ม
        </button>
      </header>
      <ul>
        {names.map((name) => {
          const active = selection?.kind === 'style' && selection.name === name;
          return (
            <li
              key={name}
              className={active ? 'is-active' : ''}
              onClick={() => dispatch({ type: 'select', selection: { kind: 'style', name } })}
            >
              <input
                className="style-name"
                defaultValue={name}
                onFocus={() => dispatch({ type: 'select', selection: { kind: 'style', name } })}
                onBlur={(e) => {
                  if (!renameStyle(name, e.target.value)) e.target.value = name;
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                }}
              />
              <span className="reorder">
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={(e) => {
                    e.stopPropagation();
                    removeStyle(name);
                  }}
                >
                  ×
                </button>
              </span>
            </li>
          );
        })}
        {names.length === 0 && <li className="empty">ว่าง</li>}
      </ul>
      {error && <p className="tree-error">{error}</p>}
    </section>
  );
}
