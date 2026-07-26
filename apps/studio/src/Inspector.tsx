import type { Node, Style, Template } from '@pdftc/schema';
import { PAGE_PRESETS } from '@pdftc/schema';
import { Num, Row, Section, Segment, Select, Text } from './fields';
import { BindingHint, StyleEditor } from './StyleEditor';
import { TableEditor } from './TableEditor';
import { applyStylePatch, layerItems, mergeNodeStyle, removePlaced, updatePlaced, withLayerItems, type Action, type Selection } from './state';

interface Props {
  template: Template;
  selection: Selection;
  dispatch: (action: Action) => void;
}

export function Inspector({ template, selection, dispatch }: Props) {
  const commit = (next: Template) => dispatch({ type: 'setTemplate', template: next });

  if (!selection || selection.kind === 'page') return <PageInspector template={template} commit={commit} />;

  if (selection.kind === 'placed') {
    const item = layerItems(template, selection.layer)[selection.index];
    if (!item) return <p className="hint pad">ไม่พบวัตถุที่เลือก</p>;

    const patchFrame = (patch: Partial<typeof item.frame>) =>
      commit(updatePlaced(template, selection.layer, selection.index, (it) => ({ ...it, frame: { ...it.frame, ...patch } })));

    const patchNode = (next: Node) => commit(updatePlaced(template, selection.layer, selection.index, (it) => ({ ...it, node: next })));

    return (
      <>
        <Section
          title={`${selection.layer} · ${item.node.type}`}
          actions={
            <button type="button" className="danger" onClick={() => {
              commit(removePlaced(template, selection.layer, selection.index));
              dispatch({ type: 'select', selection: null });
            }}>
              ลบ
            </button>
          }
        >
          <Row label="ชื่อ">
            <Text value={item.node.name} placeholder={item.node.id} onChange={(v) => patchNode({ ...item.node, name: v || undefined })} />
          </Row>
          <Row label="ตำแหน่ง">
            <span className="quad">
              <Num value={item.frame.x} onChange={(v) => patchFrame({ x: v ?? 0 })} suffix="x" />
              <Num value={item.frame.y} onChange={(v) => patchFrame({ y: v ?? 0 })} suffix="y" />
            </span>
          </Row>
          <Row label="ขนาด">
            <span className="quad">
              <Num value={item.frame.w} onChange={(v) => patchFrame({ w: v ?? 10 })} suffix="w" />
              <Num value={item.frame.h} onChange={(v) => patchFrame({ h: v })} suffix="h" />
            </span>
          </Row>
          <Row label="หมุน">
            <Num value={item.frame.rotate} step={1} suffix="°" onChange={(v) => patchFrame({ rotate: v ?? 0 })} />
          </Row>
          <Row label="แสดงหน้า">
            <Select
              value={typeof item.on === 'string' ? item.on : 'custom'}
              options={[
                { value: 'all', label: 'ทุกหน้า' },
                { value: 'first', label: 'หน้าแรก' },
                { value: 'last', label: 'หน้าสุดท้าย' },
                { value: 'exceptFirst', label: 'ยกเว้นหน้าแรก' },
              ]}
              onChange={(v) => commit(updatePlaced(template, selection.layer, selection.index, (it) => ({ ...it, on: v as typeof it.on })))}
            />
          </Row>
          <Row label="เงื่อนไขแสดง">
            <Text
              value={item.node.visibleIf}
              placeholder="เช่น doc.cancelled"
              onChange={(v) => patchNode({ ...item.node, visibleIf: v || undefined })}
            />
          </Row>
        </Section>

        <NodeInspector node={item.node} template={template} onChange={patchNode} />
      </>
    );
  }

  if (selection.kind === 'style') {
    const style = template.styles[selection.name];
    if (style === undefined) return <p className="hint pad">ไม่พบสไตล์ที่เลือก</p>;

    const patchStyle = (patch: Style) =>
      commit({ ...template, styles: { ...template.styles, [selection.name]: applyStylePatch(style, patch) } });

    return (
      <>
        <Section
          title={`สไตล์ · ${selection.name}`}
          actions={
            <button
              type="button"
              className="danger"
              onClick={() => {
                const styles = { ...template.styles };
                delete styles[selection.name];
                commit({ ...template, styles });
                dispatch({ type: 'select', selection: null });
              }}
            >
              ลบ
            </button>
          }
        />
        <StyleEditor style={style} onChange={patchStyle} />
      </>
    );
  }

  const node = template.body[selection.index];
  if (!node) return <p className="hint pad">ไม่พบวัตถุที่เลือก</p>;
  const patchNode = (next: Node) => commit({ ...template, body: template.body.map((n, i) => (i === selection.index ? next : n)) });

  return (
    <>
      <Section
        title={`body · ${node.type}`}
        actions={
          <button type="button" className="danger" onClick={() => {
            commit({ ...template, body: template.body.filter((_, i) => i !== selection.index) });
            dispatch({ type: 'select', selection: null });
          }}>
            ลบ
          </button>
        }
      >
        <Row label="ชื่อ">
          <Text value={node.name} placeholder={node.id} onChange={(v) => patchNode({ ...node, name: v || undefined })} />
        </Row>
        <Row label="เงื่อนไขแสดง">
          <Text value={node.visibleIf} placeholder="เช่น items.length > 0" onChange={(v) => patchNode({ ...node, visibleIf: v || undefined })} />
        </Row>
      </Section>
      <NodeInspector node={node} template={template} onChange={patchNode} />
    </>
  );
}

function NodeInspector({ node, template, onChange }: { node: Node; template: Template; onChange: (next: Node) => void }) {
  const styleNames = Object.keys(template.styles);
  const onStyle = (patch: Style) => onChange(mergeNodeStyle(node, patch));

  return (
    <>
      {node.type === 'text' && <Section title="ข้อความ"><BindingHint value={node.content} onChange={(v) => onChange({ ...node, content: v })} /></Section>}

      {node.type === 'image' && (
        <Section title="รูปภาพ">
          <BindingHint label="แหล่งรูป" value={node.src} onChange={(v) => onChange({ ...node, src: v })} />
          <Row label="การจัดรูป">
            <Segment
              value={node.fit}
              options={[
                { value: 'contain', label: 'พอดี' },
                { value: 'cover', label: 'เต็ม' },
                { value: 'fill', label: 'ยืด' },
              ]}
              onChange={(v) => onChange({ ...node, fit: v })}
            />
          </Row>
        </Section>
      )}

      {node.type === 'barcode' && (
        <Section title="บาร์โค้ด">
          <Row label="รูปแบบ">
            <Select
              value={node.format}
              options={[
                { value: 'qr', label: 'QR' },
                { value: 'code128', label: 'Code 128' },
                { value: 'ean13', label: 'EAN-13' },
              ]}
              onChange={(v) => onChange({ ...node, format: v })}
            />
          </Row>
          <BindingHint label="ค่า" value={node.value} onChange={(v) => onChange({ ...node, value: v })} />
        </Section>
      )}

      {node.type === 'pageNumber' && (
        <Section title="เลขหน้า">
          <Row label="รูปแบบ">
            <Text value={node.format} placeholder="หน้า {page} จาก {pages}" onChange={(v) => onChange({ ...node, format: v })} />
          </Row>
        </Section>
      )}

      {node.type === 'line' && (
        <Section title="เส้น">
          <Row label="แนว">
            <Segment
              value={node.orientation}
              options={[
                { value: 'horizontal', label: 'นอน' },
                { value: 'vertical', label: 'ตั้ง' },
              ]}
              onChange={(v) => onChange({ ...node, orientation: v })}
            />
          </Row>
        </Section>
      )}

      {node.type === 'stack' && (
        <Section title="กลุ่ม">
          <Row label="ทิศทาง">
            <Segment
              value={node.direction}
              options={[
                { value: 'column', label: 'แนวตั้ง' },
                { value: 'row', label: 'แนวนอน' },
              ]}
              onChange={(v) => onChange({ ...node, direction: v })}
            />
          </Row>
          <Row label="ระยะห่าง">
            <Num value={node.gap} suffix="mm" onChange={(v) => onChange({ ...node, gap: v ?? 0 })} />
          </Row>
          <Row label="วนซ้ำจาก">
            <Text
              value={node.each?.in}
              placeholder="เช่น items"
              onChange={(v) => onChange({ ...node, each: v ? { in: v, as: node.each?.as ?? 'it', indexAs: 'i' } : undefined })}
            />
          </Row>
        </Section>
      )}

      {node.type === 'table' && <TableEditor node={node} onChange={onChange} styleNames={styleNames} />}

      <StyleEditor
        style={node.style}
        onChange={onStyle}
        styleNames={styleNames}
        styleRef={node.styleRef}
        onStyleRef={(name) => onChange({ ...node, styleRef: name })}
      />
    </>
  );
}

function PageInspector({ template, commit }: { template: Template; commit: (t: Template) => void }) {
  const page = template.page;
  return (
    <>
      <Section title="เอกสาร">
        <Row label="ชื่อ">
          <Text value={template.name} onChange={(v) => commit({ ...template, name: v })} />
        </Row>
      </Section>

      <Section title="หน้ากระดาษ">
        <Row label="ขนาด">
          <Select
            value={page.preset}
            options={[...Object.keys(PAGE_PRESETS), 'custom'].map((p) => ({ value: p as typeof page.preset, label: p }))}
            onChange={(v) => commit({ ...template, page: { ...page, preset: v } })}
          />
        </Row>
        {page.preset === 'custom' && (
          <Row label="กว้าง × สูง">
            <span className="quad">
              <Num value={page.width} suffix="mm" onChange={(v) => commit({ ...template, page: { ...page, width: v } })} />
              <Num value={page.height} suffix="mm" onChange={(v) => commit({ ...template, page: { ...page, height: v } })} />
            </span>
          </Row>
        )}
        <Row label="แนว">
          <Segment
            value={page.orientation}
            options={[
              { value: 'portrait', label: 'ตั้ง' },
              { value: 'landscape', label: 'นอน' },
            ]}
            onChange={(v) => commit({ ...template, page: { ...page, orientation: v } })}
          />
        </Row>
        <Row label="ขอบ (บน/ขวา/ล่าง/ซ้าย)">
          <span className="quad">
            {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
              <Num
                key={side}
                value={page.margin[side]}
                onChange={(v) => commit({ ...template, page: { ...page, margin: { ...page.margin, [side]: v ?? 0 } } })}
              />
            ))}
          </span>
        </Row>
        <Row label="สีพื้น">
          <Text value={page.background} placeholder="#ffffff" onChange={(v) => commit({ ...template, page: { ...page, background: v || undefined } })} />
        </Row>
      </Section>

      <Section title="แถบหัว/ท้าย">
        <p className="hint">ความสูงของแถบจะถูกกันไว้ทุกหน้า พื้นที่ body จะย่อลงตามนี้</p>
        <Row label="สูงหัวกระดาษ">
          <Num value={template.header.height} suffix="mm" min={0} onChange={(v) => commit({ ...template, header: { ...template.header, height: v ?? 0 } })} />
        </Row>
        <Row label="สูงท้ายกระดาษ">
          <Num value={template.footer.height} suffix="mm" min={0} onChange={(v) => commit({ ...template, footer: { ...template.footer, height: v ?? 0 } })} />
        </Row>
      </Section>

      <Section title="สไตล์เริ่มต้น">
        <StyleEditor style={template.defaultStyle} onChange={(patch) => commit({ ...template, defaultStyle: { ...template.defaultStyle, ...patch } })} />
      </Section>
    </>
  );
}

export { withLayerItems };
