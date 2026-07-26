import type { Cell, Node, Row as TRow, TableNode } from '@pdftc/schema';
import { newId } from './state';
import { Num, Row, Section, Text } from './fields';

type SectionKey = 'head' | 'body' | 'foot';
const SECTIONS: { key: SectionKey; label: string }[] = [
  { key: 'head', label: 'หัวตาราง (ซ้ำทุกหน้า)' },
  { key: 'body', label: 'เนื้อตาราง' },
  { key: 'foot', label: 'ท้ายตาราง (หน้าสุดท้าย)' },
];

/** Cells hold a node list; the editor exposes the first text node inline and
 *  leaves richer cells to the tree. */
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

export function TableEditor({ node, onChange }: { node: TableNode; onChange: (next: Node) => void }) {
  const colCount = node.columns.length;

  const patch = (next: Partial<TableNode>) => onChange({ ...node, ...next });

  const setRows = (key: SectionKey, rows: TRow[]) => patch({ [key]: rows } as Partial<TableNode>);

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
                      setRows(
                        key,
                        node[key].map((r, i) =>
                          i === ri ? { ...r, each: v ? { in: v, as: r.each?.as ?? 'it', indexAs: r.each?.indexAs ?? 'i' } : undefined } : r,
                        ),
                      )
                    }
                  />
                  <Text
                    value={row.each?.as}
                    placeholder="ชื่อตัวแปร"
                    onChange={(v) =>
                      setRows(
                        key,
                        node[key].map((r, i) => (i === ri && r.each ? { ...r, each: { ...r.each, as: v } } : r)),
                      )
                    }
                  />
                </span>
              </Row>

              <Row label="ความสูง">
                <Num
                  value={row.height}
                  suffix="mm"
                  onChange={(v) => setRows(key, node[key].map((r, i) => (i === ri ? { ...r, height: v } : r)))}
                />
              </Row>

              {row.cells.map((cell, ci) => (
                <Row key={ci} label={`ช่อง ${ci + 1}`}>
                  <span className="inline">
                    <Text
                      value={cellText(cell)}
                      placeholder="{{ it.name }}"
                      onChange={(v) =>
                        setRows(
                          key,
                          node[key].map((r, i) => (i === ri ? { ...r, cells: r.cells.map((c, j) => (j === ci ? setCellText(c, v) : c)) } : r)),
                        )
                      }
                    />
                    <Num
                      value={cell.colSpan}
                      step={1}
                      min={1}
                      suffix="cs"
                      onChange={(v) =>
                        setRows(
                          key,
                          node[key].map((r, i) => (i === ri ? { ...r, cells: r.cells.map((c, j) => (j === ci ? { ...c, colSpan: v } : c)) } : r)),
                        )
                      }
                    />
                    <Num
                      value={cell.rowSpan}
                      step={1}
                      min={1}
                      suffix="rs"
                      onChange={(v) =>
                        setRows(
                          key,
                          node[key].map((r, i) => (i === ri ? { ...r, cells: r.cells.map((c, j) => (j === ci ? { ...c, rowSpan: v } : c)) } : r)),
                        )
                      }
                    />
                  </span>
                </Row>
              ))}
            </div>
          ))}
        </Section>
      ))}
    </>
  );
}
