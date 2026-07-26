/**
 * Expression language for template bindings.
 *
 * Deliberately not JavaScript: templates are user-authored data that the
 * server renders, so there is no `eval` and no property access that can
 * reach outside the supplied data object.
 *
 *   {{ customer.name }}
 *   {{ items[0].price | number:2 }}
 *   {{ issuedAt | thaidate:'D MMMM YYYY' }}
 *   visibleIf: "total > 0 && !draft"
 */

export type Scope = Record<string, unknown>;

type Tok =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'ident'; v: string }
  | { k: 'op'; v: string };

const OPS = ['===', '!==', '==', '!=', '>=', '<=', '&&', '||', '??', '>', '<', '!', '(', ')', '[', ']', '.', ',', ':', '|', '+', '-', '*', '/', '%'];

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c;
      let s = '';
      i++;
      while (i < src.length && src[i] !== quote) {
        if (src[i] === '\\') i++;
        s += src[i++];
      }
      i++; // closing quote
      out.push({ k: 'str', v: s });
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      let s = '';
      while (i < src.length && /[0-9.]/.test(src[i]!)) s += src[i++];
      out.push({ k: 'num', v: Number(s) });
      continue;
    }
    if (/[A-Za-z_$฀-๿]/.test(c)) {
      let s = '';
      while (i < src.length && /[A-Za-z0-9_$฀-๿]/.test(src[i]!)) s += src[i++];
      out.push({ k: 'ident', v: s });
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) throw new Error(`Unexpected character ${JSON.stringify(c)} at ${i} in ${JSON.stringify(src)}`);
    out.push({ k: 'op', v: op });
    i += op.length;
  }
  return out;
}

class Parser {
  private pos = 0;
  constructor(private readonly toks: Tok[], private readonly src: string) {}

  private peek(): Tok | undefined {
    return this.toks[this.pos];
  }

  private eatOp(v: string): boolean {
    const t = this.peek();
    if (t?.k === 'op' && t.v === v) {
      this.pos++;
      return true;
    }
    return false;
  }

  private expectOp(v: string): void {
    if (!this.eatOp(v)) throw new Error(`Expected ${JSON.stringify(v)} in ${JSON.stringify(this.src)}`);
  }

  atEnd(): boolean {
    return this.pos >= this.toks.length;
  }

  /** `expr | filter:arg | filter` — the outermost layer of an interpolation. */
  parsePiped(scope: Scope): unknown {
    let value = this.parseOr(scope);
    while (this.eatOp('|')) {
      const name = this.peek();
      if (name?.k !== 'ident') throw new Error(`Expected filter name in ${JSON.stringify(this.src)}`);
      this.pos++;
      const args: unknown[] = [];
      while (this.eatOp(':')) args.push(this.parseUnary(scope));
      const fn = FILTERS[name.v];
      if (!fn) throw new Error(`Unknown filter ${JSON.stringify(name.v)}`);
      value = fn(value, ...args);
    }
    return value;
  }

  private parseOr(scope: Scope): unknown {
    let left = this.parseAnd(scope);
    for (;;) {
      if (this.eatOp('||')) left = truthy(left) ? left : this.parseAnd(scope);
      else if (this.eatOp('??')) {
        const right = this.parseAnd(scope);
        left = left ?? right;
      } else return left;
    }
  }

  private parseAnd(scope: Scope): unknown {
    let left = this.parseCompare(scope);
    while (this.eatOp('&&')) {
      const right = this.parseCompare(scope);
      left = truthy(left) ? right : left;
    }
    return left;
  }

  private parseCompare(scope: Scope): unknown {
    const left = this.parseAdd(scope);
    for (const op of ['===', '!==', '==', '!=', '>=', '<=', '>', '<']) {
      if (this.eatOp(op)) {
        const right = this.parseAdd(scope);
        switch (op) {
          case '===':
          case '==':
            return left == right; // eslint-disable-line eqeqeq
          case '!==':
          case '!=':
            return left != right; // eslint-disable-line eqeqeq
          case '>=':
            return Number(left) >= Number(right);
          case '<=':
            return Number(left) <= Number(right);
          case '>':
            return Number(left) > Number(right);
          default:
            return Number(left) < Number(right);
        }
      }
    }
    return left;
  }

  private parseAdd(scope: Scope): unknown {
    let left = this.parseMul(scope);
    for (;;) {
      if (this.eatOp('+')) {
        const right = this.parseMul(scope);
        left = typeof left === 'string' || typeof right === 'string' ? String(left ?? '') + String(right ?? '') : Number(left) + Number(right);
      } else if (this.eatOp('-')) left = Number(left) - Number(this.parseMul(scope));
      else return left;
    }
  }

  private parseMul(scope: Scope): unknown {
    let left = this.parseUnary(scope);
    for (;;) {
      if (this.eatOp('*')) left = Number(left) * Number(this.parseUnary(scope));
      else if (this.eatOp('/')) left = Number(left) / Number(this.parseUnary(scope));
      else if (this.eatOp('%')) left = Number(left) % Number(this.parseUnary(scope));
      else return left;
    }
  }

  private parseUnary(scope: Scope): unknown {
    if (this.eatOp('!')) return !truthy(this.parseUnary(scope));
    if (this.eatOp('-')) return -Number(this.parseUnary(scope));
    return this.parsePrimary(scope);
  }

  private parsePrimary(scope: Scope): unknown {
    const t = this.peek();
    if (!t) throw new Error(`Unexpected end of expression ${JSON.stringify(this.src)}`);
    if (t.k === 'num' || t.k === 'str') {
      this.pos++;
      return t.v;
    }
    if (t.k === 'op' && t.v === '(') {
      this.pos++;
      const v = this.parseOr(scope);
      this.expectOp(')');
      return v;
    }
    if (t.k === 'ident') {
      this.pos++;
      if (t.v === 'true') return true;
      if (t.v === 'false') return false;
      if (t.v === 'null') return null;
      return this.parseAccess(scope, readOwn(scope, t.v), scope);
    }
    throw new Error(`Unexpected token in ${JSON.stringify(this.src)}`);
  }

  /** `.prop` and `[expr]` chains, short-circuiting on nullish like `?.`. */
  private parseAccess(scope: Scope, base: unknown, root: Scope): unknown {
    let cur = base;
    for (;;) {
      if (this.eatOp('.')) {
        const p = this.peek();
        if (p?.k !== 'ident') throw new Error(`Expected property name in ${JSON.stringify(this.src)}`);
        this.pos++;
        cur = cur == null ? undefined : readOwn(cur as Scope, p.v);
      } else if (this.eatOp('[')) {
        const key = this.parseOr(root);
        this.expectOp(']');
        cur = cur == null ? undefined : readOwn(cur as Scope, String(key));
      } else return cur;
    }
  }
}

const BLOCKED = new Set(['__proto__', 'constructor', 'prototype']);

function readOwn(obj: unknown, key: string): unknown {
  if (obj == null || BLOCKED.has(key)) return undefined;
  if (Array.isArray(obj) && key === 'length') return obj.length;
  if (typeof obj === 'string' && key === 'length') return obj.length;
  if (typeof obj !== 'object') return undefined;
  return Object.prototype.hasOwnProperty.call(obj, key) ? (obj as Record<string, unknown>)[key] : undefined;
}

function truthy(v: unknown): boolean {
  if (Array.isArray(v)) return v.length > 0;
  return Boolean(v);
}

/** Evaluate a single expression (no `{{ }}` wrapper). Returns the raw value. */
export function evaluate(src: string, scope: Scope): unknown {
  const p = new Parser(tokenize(src), src);
  const v = p.parsePiped(scope);
  if (!p.atEnd()) throw new Error(`Trailing input in expression ${JSON.stringify(src)}`);
  return v;
}

export function evaluateBool(src: string | undefined, scope: Scope): boolean {
  if (src == null || src === '') return true;
  return truthy(evaluate(src, scope));
}

const INTERP = /\{\{([\s\S]*?)\}\}/g;

/** Substitute every `{{ … }}` in a string. Returns the raw value when the
 *  whole string is one interpolation, so numbers survive round-trips. */
export function interpolate(src: string, scope: Scope): string {
  return src.replace(INTERP, (_m, body: string) => {
    const v = evaluate(body, scope);
    return v == null ? '' : String(v);
  });
}

export function hasInterpolation(src: string): boolean {
  INTERP.lastIndex = 0;
  return INTERP.test(src);
}

/* ── Filters ─────────────────────────────────────────────────── */

export type Filter = (value: unknown, ...args: unknown[]) => unknown;

const TH_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const TH_MONTHS_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

function toDate(v: unknown): Date | null {
  if (v instanceof Date) return v;
  if (typeof v === 'number') return new Date(v);
  if (typeof v === 'string') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Formats a date with a subset of the Moment tokens. `buddhist` shifts the year. */
function formatDate(d: Date, fmt: string, buddhist: boolean): string {
  const year = d.getFullYear() + (buddhist ? 543 : 0);
  const map: Record<string, string> = {
    YYYY: String(year),
    YY: String(year).slice(-2),
    MMMM: TH_MONTHS[d.getMonth()]!,
    MMM: TH_MONTHS_SHORT[d.getMonth()]!,
    MM: pad2(d.getMonth() + 1),
    M: String(d.getMonth() + 1),
    DD: pad2(d.getDate()),
    D: String(d.getDate()),
    HH: pad2(d.getHours()),
    mm: pad2(d.getMinutes()),
    ss: pad2(d.getSeconds()),
  };
  return fmt.replace(/YYYY|YY|MMMM|MMM|MM|M|DD|D|HH|mm|ss/g, (t) => map[t] ?? t);
}

const TH_DIGITS = ['ศูนย์', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
const TH_PLACES = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน', 'ล้าน'];

/** Thai reading of an integer, following the สิบ/เอ็ด/ยี่ irregularities. */
function thaiInteger(n: number): string {
  if (n === 0) return TH_DIGITS[0]!;
  if (n >= 1_000_000) {
    const millions = Math.floor(n / 1_000_000);
    const rest = n % 1_000_000;
    return thaiInteger(millions) + 'ล้าน' + (rest ? thaiInteger(rest) : '');
  }
  const digits = String(n).split('').map(Number);
  let out = '';
  digits.forEach((d, i) => {
    const place = digits.length - 1 - i;
    if (d === 0) return;
    if (place === 1 && d === 1) out += TH_PLACES[1]!;
    else if (place === 1 && d === 2) out += 'ยี่' + TH_PLACES[1]!;
    else if (place === 0 && d === 1 && digits.length > 1) out += 'เอ็ด';
    else out += TH_DIGITS[d]! + TH_PLACES[place]!;
  });
  return out;
}

/** `1234.50` → `หนึ่งพันสองร้อยสามสิบสี่บาทห้าสิบสตางค์` */
export function bahttext(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  const negative = n < 0;
  const abs = Math.abs(n);
  const baht = Math.floor(abs);
  const satang = Math.round((abs - baht) * 100);
  let out = baht === 0 && satang > 0 ? '' : thaiInteger(baht) + 'บาท';
  out += satang === 0 ? 'ถ้วน' : thaiInteger(satang) + 'สตางค์';
  return (negative ? 'ลบ' : '') + out;
}

export const FILTERS: Record<string, Filter> = {
  number: (v, digits = 2) =>
    Number.isFinite(Number(v))
      ? Number(v).toLocaleString('en-US', { minimumFractionDigits: Number(digits), maximumFractionDigits: Number(digits) })
      : '',
  currency: (v, symbol = '฿', digits = 2) => (Number.isFinite(Number(v)) ? `${symbol}${FILTERS.number!(v, digits)}` : ''),
  int: (v) => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : ''),
  round: (v, digits = 0) => {
    const f = 10 ** Number(digits);
    return Math.round(Number(v) * f) / f;
  },
  date: (v, fmt = 'DD/MM/YYYY') => {
    const d = toDate(v);
    return d ? formatDate(d, String(fmt), false) : '';
  },
  thaidate: (v, fmt = 'D MMMM YYYY') => {
    const d = toDate(v);
    return d ? formatDate(d, String(fmt), true) : '';
  },
  bahttext,
  upper: (v) => String(v ?? '').toUpperCase(),
  lower: (v) => String(v ?? '').toLowerCase(),
  trim: (v) => String(v ?? '').trim(),
  default: (v, fallback = '') => (v == null || v === '' ? fallback : v),
  truncate: (v, len = 40, suffix = '…') => {
    const s = String(v ?? '');
    return s.length > Number(len) ? s.slice(0, Number(len)) + String(suffix) : s;
  },
  padStart: (v, len = 0, ch = '0') => String(v ?? '').padStart(Number(len), String(ch)),
  join: (v, sep = ', ') => (Array.isArray(v) ? v.join(String(sep)) : String(v ?? '')),
  length: (v) => (Array.isArray(v) || typeof v === 'string' ? v.length : 0),
  sum: (v, key) => (Array.isArray(v) ? v.reduce((a: number, x) => a + Number(key == null ? x : readOwn(x, String(key))), 0) : 0),
};

/** Register a project-specific filter, e.g. a company number format. */
export function registerFilter(name: string, fn: Filter): void {
  FILTERS[name] = fn;
}
