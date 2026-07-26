import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bahttext, evaluate, evaluateBool, interpolate } from '../src/expr.ts';

const scope = {
  customer: { name: 'สยามรีเทล', taxId: '0107537000123' },
  items: [
    { name: 'A', qty: 2, price: 100 },
    { name: 'B', qty: 3, price: 50 },
  ],
  total: 350,
  draft: false,
  issuedAt: '2026-07-26T10:30:00+07:00',
};

test('path access', () => {
  assert.equal(evaluate('customer.name', scope), 'สยามรีเทล');
  assert.equal(evaluate('items[1].name', scope), 'B');
  assert.equal(evaluate('items.length', scope), 2);
  assert.equal(evaluate('missing.deep.path', scope), undefined);
});

test('arithmetic and comparison', () => {
  assert.equal(evaluate('items[0].qty * items[0].price', scope), 200);
  assert.equal(evaluate('total > 300', scope), true);
  assert.equal(evaluate('total >= 350 && !draft', scope), true);
  assert.equal(evaluate("customer.taxId == '0107537000123'", scope), true);
});

test('prototype access is blocked', () => {
  assert.equal(evaluate('customer.constructor', scope), undefined);
  assert.equal(evaluate('customer.__proto__', scope), undefined);
});

test('filters', () => {
  assert.equal(evaluate('total | number:2', scope), '350.00');
  // Filter arguments are expressions, so a field name must be quoted.
  assert.equal(evaluate("items | sum:'qty'", scope), 5);
  assert.equal(evaluate('items | length', scope), 2);
  assert.equal(evaluate("issuedAt | thaidate:'D MMMM YYYY'", scope), '26 กรกฎาคม 2569');
  assert.equal(evaluate("issuedAt | date:'DD/MM/YYYY'", scope), '26/07/2026');
  assert.equal(evaluate("missing | default:'—'", scope), '—');
});

test('interpolation', () => {
  assert.equal(interpolate('เรียน {{ customer.name }}', scope), 'เรียน สยามรีเทล');
  assert.equal(interpolate('{{ items[0].qty }} x {{ items[0].price }}', scope), '2 x 100');
  assert.equal(interpolate('{{ missing }}', scope), '');
});

test('visibleIf defaults to visible', () => {
  assert.equal(evaluateBool(undefined, scope), true);
  assert.equal(evaluateBool('draft', scope), false);
  assert.equal(evaluateBool('items', scope), true);
  assert.equal(evaluateBool('missing', scope), false);
});

test('bahttext', () => {
  assert.equal(bahttext(0), 'ศูนย์บาทถ้วน');
  assert.equal(bahttext(1), 'หนึ่งบาทถ้วน');
  assert.equal(bahttext(11), 'สิบเอ็ดบาทถ้วน');
  assert.equal(bahttext(21), 'ยี่สิบเอ็ดบาทถ้วน');
  assert.equal(bahttext(100), 'หนึ่งร้อยบาทถ้วน');
  assert.equal(bahttext(1234.5), 'หนึ่งพันสองร้อยสามสิบสี่บาทห้าสิบสตางค์');
  assert.equal(bahttext(1_000_000), 'หนึ่งล้านบาทถ้วน');
  assert.equal(bahttext(2_753_345.27), 'สองล้านเจ็ดแสนห้าหมื่นสามพันสามร้อยสี่สิบห้าบาทยี่สิบเจ็ดสตางค์');
  assert.equal(bahttext(-5), 'ลบห้าบาทถ้วน');
});
