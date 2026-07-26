import type { ReactNode } from 'react';

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      <div className="field-control">{children}</div>
    </label>
  );
}

export function Num({
  value,
  onChange,
  step = 0.5,
  suffix,
  min,
}: {
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  step?: number;
  suffix?: string;
  min?: number;
}) {
  return (
    <span className={suffix ? 'num has-suffix' : 'num'}>
      <input
        type="number"
        step={step}
        min={min}
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
      />
      {suffix && <em>{suffix}</em>}
    </span>
  );
}

export function Text({ value, onChange, placeholder }: { value: string | undefined; onChange: (v: string) => void; placeholder?: string }) {
  return <input type="text" value={value ?? ''} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />;
}

export function Area({ value, onChange, rows = 3 }: { value: string | undefined; onChange: (v: string) => void; rows?: number }) {
  return <textarea rows={rows} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
}

export function Color({ value, onChange }: { value: string | undefined; onChange: (v: string | undefined) => void }) {
  return (
    <span className="color">
      <input type="color" value={value ?? '#000000'} onChange={(e) => onChange(e.target.value)} />
      <input type="text" value={value ?? ''} placeholder="—" onChange={(e) => onChange(e.target.value || undefined)} />
      {value && (
        <button type="button" className="ghost" title="ล้างค่า" onClick={() => onChange(undefined)}>
          ×
        </button>
      )}
    </span>
  );
}

export function Select<T extends string | number>({
  value,
  options,
  onChange,
}: {
  value: T | undefined;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <select
      value={String(value ?? '')}
      onChange={(e) => {
        const found = options.find((o) => String(o.value) === e.target.value);
        if (found) onChange(found.value);
      }}
    >
      {value === undefined && <option value="">—</option>}
      {options.map((o) => (
        <option key={String(o.value)} value={String(o.value)}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Segment<T extends string>({ value, options, onChange }: { value: T | undefined; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="segment">
      {options.map((o) => (
        <button key={o.value} type="button" className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Section({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="panel-section">
      <header>
        <h3>{title}</h3>
        {actions}
      </header>
      <div className="panel-body">{children}</div>
    </section>
  );
}
