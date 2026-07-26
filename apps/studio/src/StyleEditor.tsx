import type { Style } from '@pdftc/schema';
import { FONT_FAMILIES } from '@pdftc/fonts/list';
import { Color, Num, Row, Section, Segment, Select, Text } from './fields';

interface Props {
  style: Style | undefined;
  onChange: (patch: Style) => void;
  /** Named styles available in the template, for the `styleRef` picker. */
  styleNames?: string[];
  styleRef?: string;
  onStyleRef?: (name: string | undefined) => void;
}

export function StyleEditor({ style, onChange, styleNames = [], styleRef, onStyleRef }: Props) {
  const s = style ?? {};
  const set = <K extends keyof Style>(key: K, value: Style[K]) => onChange({ [key]: value } as Style);
  const border = s.border?.all;

  return (
    <>
      {onStyleRef && (
        <Section title="สไตล์ที่ใช้ร่วม">
          <Row label="styleRef">
            <select value={styleRef ?? ''} onChange={(e) => onStyleRef(e.target.value || undefined)}>
              <option value="">— ไม่ใช้ —</option>
              {styleNames.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </Row>
        </Section>
      )}

      <Section title="ตัวอักษร">
        <Row label="ฟอนต์">
          <Select
            value={s.fontFamily}
            options={FONT_FAMILIES.map((f) => ({ value: f, label: f }))}
            onChange={(v) => set('fontFamily', v)}
          />
        </Row>
        <Row label="ขนาด">
          <Num value={s.fontSize} step={0.5} suffix="pt" min={1} onChange={(v) => set('fontSize', v)} />
        </Row>
        <Row label="น้ำหนัก">
          <Select
            value={typeof s.fontWeight === 'number' ? s.fontWeight : undefined}
            options={[300, 400, 500, 600, 700].map((w) => ({ value: w, label: String(w) }))}
            onChange={(v) => set('fontWeight', v)}
          />
        </Row>
        <Row label="สี">
          <Color value={s.color} onChange={(v) => set('color', v)} />
        </Row>
        <Row label="จัดแนว">
          <Segment
            value={s.align}
            options={[
              { value: 'left', label: '⟵' },
              { value: 'center', label: '↔' },
              { value: 'right', label: '⟶' },
              { value: 'justify', label: '☰' },
            ]}
            onChange={(v) => set('align', v)}
          />
        </Row>
        <Row label="แนวตั้ง">
          <Segment
            value={s.valign}
            options={[
              { value: 'top', label: 'บน' },
              { value: 'middle', label: 'กลาง' },
              { value: 'bottom', label: 'ล่าง' },
            ]}
            onChange={(v) => set('valign', v)}
          />
        </Row>
        <Row label="ระยะบรรทัด">
          <Num value={s.lineHeight} step={0.05} onChange={(v) => set('lineHeight', v)} />
        </Row>
        <Row label="ระยะอักษร">
          <Num value={s.letterSpacing} step={0.1} suffix="pt" onChange={(v) => set('letterSpacing', v)} />
        </Row>
        <Row label="ลักษณะ">
          <span className="checks">
            <label>
              <input type="checkbox" checked={Boolean(s.italic)} onChange={(e) => set('italic', e.target.checked || undefined)} /> เอียง
            </label>
            <label>
              <input type="checkbox" checked={Boolean(s.underline)} onChange={(e) => set('underline', e.target.checked || undefined)} /> ขีดเส้นใต้
            </label>
            <label title="ลดขนาดฟอนต์อัตโนมัติจนข้อความพอดีกรอบ">
              <input type="checkbox" checked={Boolean(s.shrinkToFit)} onChange={(e) => set('shrinkToFit', e.target.checked || undefined)} /> ย่อให้พอดี
            </label>
            <label>
              <input
                type="checkbox"
                checked={s.whiteSpace === 'pre-wrap'}
                onChange={(e) => set('whiteSpace', e.target.checked ? 'pre-wrap' : undefined)}
              />{' '}
              คงบรรทัด
            </label>
          </span>
        </Row>
      </Section>

      <Section title="กล่อง">
        <Row label="พื้นหลัง">
          <Color value={s.background} onChange={(v) => set('background', v)} />
        </Row>
        <Row label="เส้นขอบ">
          <span className="inline">
            <Num
              value={border?.width}
              step={0.1}
              suffix="pt"
              onChange={(v) => set('border', v == null ? {} : { all: { width: v, style: border?.style ?? 'solid', color: border?.color ?? '#000000' } })}
            />
            <Select
              value={border?.style ?? 'solid'}
              options={[
                { value: 'solid', label: 'ทึบ' },
                { value: 'dashed', label: 'ประ' },
                { value: 'dotted', label: 'จุด' },
                { value: 'double', label: 'คู่' },
              ]}
              onChange={(v) => set('border', { all: { width: border?.width ?? 0.3, style: v, color: border?.color ?? '#000000' } })}
            />
          </span>
        </Row>
        <Row label="สีขอบ">
          <Color
            value={border?.color}
            onChange={(v) => set('border', { all: { width: border?.width ?? 0.3, style: border?.style ?? 'solid', color: v ?? '#000000' } })}
          />
        </Row>
        <Row label="มุมโค้ง">
          <Num value={s.radius} step={0.5} suffix="mm" min={0} onChange={(v) => set('radius', v)} />
        </Row>
        <Row label="ระยะขอบใน">
          <span className="quad">
            {(['top', 'right', 'bottom', 'left'] as const).map((side) => (
              <Num
                key={side}
                value={s.padding?.[side]}
                step={0.5}
                onChange={(v) => set('padding', { ...(s.padding ?? { top: 0, right: 0, bottom: 0, left: 0 }), [side]: v ?? 0 })}
              />
            ))}
          </span>
        </Row>
        <Row label="ความทึบ">
          <Num value={s.opacity} step={0.05} min={0} onChange={(v) => set('opacity', v)} />
        </Row>
      </Section>
    </>
  );
}

export function BindingHint({ value, onChange, label = 'เนื้อหา' }: { value: string; onChange: (v: string) => void; label?: string }) {
  return (
    <Row label={label}>
      <div className="binding">
        <Text value={value} onChange={onChange} placeholder="ข้อความ หรือ {{ path | filter }}" />
        <small>
          ใช้ <code>{'{{ customer.name }}'}</code>, ตัวกรอง <code>number:2</code> <code>thaidate</code> <code>bahttext</code>
        </small>
      </div>
    </Row>
  );
}
