import type { Cell, Node, Row as TRow, Style, TableNode } from '@pdftc/schema';
import { applyStylePatch, newId } from './state';
import { Color, Num, Row, Section, Text } from './fields';
import { StyleEditor } from './StyleEditor';

type SectionKey = 'head' | 'body' | 'foot';
const SECTIONS: { key: SectionKey; label: string }[] = [
  { key: 'head', label: 'หัวตาราง (ซ้ำทุกหน้า)' },
  { key: 'body', label: 'เนื้อตาราง' },
  { key: 'foot', label: 'ท้ายตาราง (หน้าสุดท้าย)' },
];

const ZEBRA_DEFAULT = '#f5f7fa';

/* Cells hold a node list; the editor exposes the first text node inline and
 * leaves richer cells to the tree. */
function cellText(cell: Cell): string {
  const first = cell.content.find((n) => n.type === 'text');
  return first && first.type === 'text' ? first.content : '';
}

function setCellText(cell: Cell, value: string): Cell {
  const index = cell.content.findIndex((n) => n.type === 'text');
  if (index === -1) {
    return { ...cell, content: [...cell.content, { id: newId('text'), type: 'text', content: value }] };
  }
  const content = cell.content.map((n, i) => (i === index && n.type === 'text' ? { ...n, content: value } : n));
  return { ...cell, content };
}

function blankCell(): Cell {
  return { content: [{ id: newId('text'), type: 'text', content: '' }] };
}

function hasStyle(style: Style | undefined): boolean {
  return Boolean(style && Object.keys(style).length > 0);
}

/** Collapsed style editor. Named styles win over nothing and lose to `style`,
 *  so the summary shows both: which style is referenced, and whether the
 *  target also carries overrides of its own. */
function StyleSlot({
  title,
  styleNames,
  target,
  onStyle,
  onStyleRef,
}: {
  title: string;
  styleNames?: string[];
  target: { style?: Style; styleRef?: string };
  onStyle: (patch: Style) => void;
  onStyleRef?: (name: string | undefined) => void;
}) {
  const tags = [target.styleRef, hasStyle(target.style) ? 'กำหนดเอง' : undefined].filter(Boolean).join(' + ');
  const swatch = target.style?.background;
  return (
    <details className="style-slot">
      <summary>
        <span className="style-slot-title">{title}</span>
        <em>{tags || '—'}</em>
        <i className="swatch" style={swatch ? { background: swatch } : undefined} />
      </summary>
      <div className="style-slot-body">
        <StyleEditor
          style={target.style}
          onChange={onStyle}
          styleNames={styleNames ?? []}
          styleRef={target.styleRef}
          onStyleRef={onStyleRef}
        />
      </div>
    </details>
  );
}

export function TableEditor({ node, onChange, styleNames = [] }: { node: TableNode; onChange: (next: Node) => void; styleNames?: string[] }) {
  const colCount = node.columns.length;

  const patch = (next: Partial<TableNode>) => onChange({ ...node, ...next });

  const setRows = (key: SectionKey, rows: TRow[]) => patch({ [key]: rows } as Partial<TableNode>);

  const patchRow = (key: SectionKey, index: number, next: (row: TRow) => TRow) =>
    setRows(key, node[key].map((r, i) => (i === index ? next(r) : r)));

  const patchCell = (key: SectionKey, ri: number, ci: number, next: (cell: Cell) => Cell) =>
    patchRow(key, ri, (r) => ({ ...r, cells: r.cells.map((c, j) => (j === ci ? next(c) : c)) }));

  /* Head colour lives on the head rows so a cell that carries its own styleRef
   * can still override it — same order the renderer merges in. */
  const headStyle = node.head[0]?.style;
  const patchHead = (stylePatch: Style) =>
    patch({ head: node.head.map((r) => ({ ...r, style: applyStylePatch(r.style, stylePatch) })) });

  function addColumn() {
    patch({
      columns: [...node.columns, { width: '1fr' }],
      head: node.head.map((r) => ({ ...r, cells: [...r.cells, blankCell()] })),
      body: node.body.map((r) => ({ ...r, cells: [...r.cells, blankCell()] })),
      foot: node.foot.map((r) => ({ ...r, cells: [...r.cells, blankCell()] })),
    });
  }

  function removeColumn(index: number) {
    const drop = (rows: TRow[]) => rows.map((r) => ({ ...r, cells: r.cells.filter((_, i) => i !== index) }));
    patch({
      columns: node.columns.filter((_, i) => i !== index),
      head: drop(node.head),
      body: drop(node.body),
      foot: drop(node.foot),
    });
  }

  function addRow(key: SectionKey) {
    const row: TRow = { id: newId('row'), cells: Array.from({ length: colCount }, blankCell) };
    setRows(key, [...node[key], row]);
  }

  return (
    <>
      <Section title="สีตาราง">
        <p className="hint">
          ลำดับทับกัน: <code>ทุกช่อง</code> → <code>แถบสลับ</code> → <code>แถว</code> → <code>ช่อง</code> — อันหลังชนะ
        </p>
        <Row label="พื้นหัวตาราง">
          <Color
            value={headStyle?.background}
            onChange={(v) => patchHead({ background: v })}
          />
        </Row>
        <Row label="อักษรหัวตาราง">
          <Color value={headStyle?.color} onChange={(v) => patchHead({ color: v })} />
        </Row>
        <Row label="พื้นทุกช่อง">
          <Color
            value={node.cellStyle?.background}
            onChange={(v) => patch({ cellStyle: applyStylePatch(node.cellStyle, { background: v }) })}
          />
        </Row>
        <Row label="แถบสลับสี">
          <span className="inline">
            <input
              type="checkbox"
              checked={Boolean(node.zebraStyle)}
              onChange={(e) => patch({ zebraStyle: e.target.checked ? { background: ZEBRA_DEFAULT } : undefined })}
            />
            <Color
              value={node.zebraStyle?.background}
              onChange={(v) => patch({ zebraStyle: applyStylePatch(node.zebraStyle, { background: v }) })}
            />
          </span>
        </Row>
        {node.head.length === 0 && <p className="hint">ยังไม่มีแถวหัวตาราง — เพิ่มก่อนถึงจะตั้งสีหัวได้</p>}

        <StyleSlot
          title="สไตล์ทุกช่อง (cellStyle)"
          target={{ style: node.cellStyle }}
          onStyle={(p) => patch({ cellStyle: applyStylePatch(node.cellStyle, p) })}
        />
        <StyleSlot
          title="สไตล์แถบสลับ (zebraStyle)"
          target={{ style: node.zebraStyle }}
          onStyle={(p) => patch({ zebraStyle: applyStylePatch(node.zebraStyle, p) })}
        />
      </Section>

      <Section title="คอลัมน์" actions={<button type="button" onClick={addColumn}>+ คอลัมน์</button>}>
        <p className="hint">
          ตัวเลข = กว้างคงที่ (มม.) · <code>1fr</code> = แบ่งที่เหลือตามสัดส่วน · <code>auto</code> = พอดีเนื้อหา
        </p>
        {node.columns.map((col, i) => (
          <Row key={i} label={`คอลัมน์ ${i + 1}`}>
            <span className="inline">
              <Text
                value={String(col.width)}
                onChange={(v) => {
                  const width = /^\d+(\.\d+)?$/.test(v) ? Number(v) : (v as TableNode['columns'][number]['width']);
                  patch({ columns: node.columns.map((c, j) => (j === i ? { width } : c)) });
                }}
              />
              <button type="button" className="ghost" disabled={colCount <= 1} onClick={() => removeColumn(i)}>
                ลบ
              </button>
            </span>
          </Row>
        ))}
      </Section>

      {SECTIONS.map(({ key, label }) => (
        <Section key={key} title={label} actions={<button type="button" onClick={() => addRow(key)}>+ แถว</button>}>
          {node[key].length === 0 && <p className="hint">ยังไม่มีแถว</p>}
          {node[key].map((row, ri) => (
            <div className="row-card" key={row.id}>
              <div className="row-card-head">
                <strong>แถว {ri + 1}</strong>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => setRows(key, node[key].filter((_, i) => i !== ri))}
                >
                  ลบแถว
                </button>
              </div>

              <Row label="วนซ้ำจาก">
                <span className="inline">
                  <Text
                    value={row.each?.in}
                    placeholder="เช่น items"
                    onChange={(v) =>
                      patchRow(key, ri, (r) => ({
                        ...r,
                        each: v ? { in: v, as: r.each?.as ?? 'it', indexAs: r.each?.indexAs ?? 'i' } : undefined,
                      }))
                    }
                  />
                  <Text
                    value={row.each?.as}
                    placeholder="ชื่อตัวแปร"
                    onChange={(v) => patchRow(key, ri, (r) => (r.each ? { ...r, each: { ...r.each, as: v } } : r))}
                  />
                </span>
              </Row>

              <Row label="ความสูง">
                <Num value={row.height} suffix="mm" onChange={(v) => patchRow(key, ri, (r) => ({ ...r, height: v }))} />
              </Row>

              <Row label="พื้นแถว">
                <Color
                  value={row.style?.background}
                  onChange={(v) => patchRow(key, ri, (r) => ({ ...r, style: applyStylePatch(r.style, { background: v }) }))}
                />
              </Row>

              <StyleSlot
                title="สไตล์แถว"
                styleNames={styleNames}
                target={row}
                onStyle={(p) => patchRow(key, ri, (r) => ({ ...r, style: applyStylePatch(r.style, p) }))}
                onStyleRef={(name) => patchRow(key, ri, (r) => ({ ...r, styleRef: name }))}
              />

              {row.cells.map((cell, ci) => (
                <div className="cell-card" key={ci}>
                  <Row label={`ช่อง ${ci + 1}`}>
                    <span className="inline">
                      <Text
                        value={cellText(cell)}
                        placeholder="{{ it.name }}"
                        onChange={(v) => patchCell(key, ri, ci, (c) => setCellText(c, v))}
                      />
                      <Num
                        value={cell.colSpan}
                        step={1}
                        min={1}
                        suffix="cs"
                        onChange={(v) => patchCell(key, ri, ci, (c) => ({ ...c, colSpan: v }))}
                      />
                      <Num
                        value={cell.rowSpan}
                        step={1}
                        min={1}
                        suffix="rs"
                        onChange={(v) => patchCell(key, ri, ci, (c) => ({ ...c, rowSpan: v }))}
                      />
                    </span>
                  </Row>
                  <StyleSlot
                    title={`สไตล์ช่อง ${ci + 1}`}
                    styleNames={styleNames}
                    target={cell}
                    onStyle={(p) => patchCell(key, ri, ci, (c) => ({ ...c, style: applyStylePatch(c.style, p) }))}
                    onStyleRef={(name) => patchCell(key, ri, ci, (c) => ({ ...c, styleRef: name }))}
                  />
                </div>
              ))}
            </div>
          ))}
        </Section>
      ))}
    </>
  );
}
