import type { Node, Template } from '@pdftc/schema';
import { blankNode, layerItems, newId, withLayerItems, type Action, type LayerName, type Selection } from './state';

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
        📄 {template.name}
      </button>

      {(['header', 'overlay', 'footer'] as LayerName[]).map((layer) => (
        <section key={layer} className="tree-group">
          <header>
            <h4>{layer === 'header' ? 'หัวกระดาษ' : layer === 'footer' ? 'ท้ายกระดาษ' : 'ทับหน้า (overlay)'}</h4>
            <AddMenu onPick={(type) => addPlaced(layer, type)} />
          </header>
          <ul>
            {layerItems(template, layer).map((item, index) => {
              const active = selection?.kind === 'placed' && selection.layer === layer && selection.index === index;
              return (
                <li key={`${item.node.id}-${index}`} className={active ? 'is-active' : ''}>
                  <button type="button" onClick={() => dispatch({ type: 'select', selection: { kind: 'placed', layer, index } })}>
                    <em>{item.node.type}</em> {item.node.name ?? preview(item.node)}
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

      <section className="tree-group">
        <header>
          <h4>เนื้อหา (flow · ตัดหน้าอัตโนมัติ)</h4>
          <AddMenu onPick={addBody} />
        </header>
        <ul>
          {template.body.map((node, index) => {
            const active = selection?.kind === 'body' && selection.index === index;
            return (
              <li key={`${node.id}-${index}`} className={active ? 'is-active' : ''}>
                <button type="button" onClick={() => dispatch({ type: 'select', selection: { kind: 'body', index } })}>
                  <em>{node.type}</em> {node.name ?? preview(node)}
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

      <StylesPanel template={template} commit={commit} />
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

function StylesPanel({ template, commit }: { template: Template; commit: (t: Template) => void }) {
  const names = Object.keys(template.styles);
  return (
    <section className="tree-group">
      <header>
        <h4>สไตล์ที่ตั้งชื่อไว้</h4>
        <button
          type="button"
          className="add-menu"
          onClick={() => commit({ ...template, styles: { ...template.styles, [newId('style')]: { fontSize: 10 } } })}
        >
          + เพิ่ม
        </button>
      </header>
      <ul>
        {names.map((name) => (
          <li key={name}>
            <input
              className="style-name"
              value={name}
              onChange={(e) => {
                const next = { ...template.styles };
                const value = next[name]!;
                delete next[name];
                next[e.target.value] = value;
                commit({ ...template, styles: next });
              }}
            />
            <span className="reorder">
              <button
                type="button"
                onClick={() => {
                  const next = { ...template.styles };
                  delete next[name];
                  commit({ ...template, styles: next });
                }}
              >
                ×
              </button>
            </span>
          </li>
        ))}
        {names.length === 0 && <li className="empty">ว่าง</li>}
      </ul>
    </section>
  );
}
