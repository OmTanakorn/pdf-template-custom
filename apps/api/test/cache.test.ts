import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ResultCache } from '../src/cache.ts';

const pdf = (kb: number, fill = 1) => new Uint8Array(kb * 1024).fill(fill);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('serves a repeat request without re-rendering', () => {
  const cache = new ResultCache({ maxBytes: 1024 * 1024, ttlMs: 60_000 });
  cache.set('a', pdf(10));

  assert.deepEqual(cache.get('a'), pdf(10));
  assert.equal(cache.stats.hits, 1);
  assert.equal(cache.get('b'), undefined);
  assert.equal(cache.stats.misses, 1);
});

test('an entry stops being served once its TTL passes', async () => {
  const cache = new ResultCache({ maxBytes: 1024 * 1024, ttlMs: 20 });
  cache.set('a', pdf(10));
  assert.ok(cache.get('a'));

  await sleep(30);
  assert.equal(cache.get('a'), undefined);
  assert.equal(cache.stats.bytes, 0, 'an expired entry must not keep charging the budget');
});

test('evicts least recently used entries to stay inside the byte budget', () => {
  const cache = new ResultCache({ maxBytes: 30 * 1024, ttlMs: 60_000 });
  cache.set('a', pdf(10, 1));
  cache.set('b', pdf(10, 2));
  cache.set('c', pdf(10, 3));

  // Touching 'a' makes 'b' the coldest entry.
  assert.ok(cache.get('a'));
  cache.set('d', pdf(10, 4));

  assert.equal(cache.get('b'), undefined, 'the least recently used entry goes first');
  assert.ok(cache.get('a'));
  assert.ok(cache.get('c'));
  assert.ok(cache.get('d'));
  assert.ok(cache.stats.bytes <= 30 * 1024);
});

test('a document larger than the whole budget is not cached', () => {
  const cache = new ResultCache({ maxBytes: 10 * 1024, ttlMs: 60_000 });
  cache.set('small', pdf(4));
  cache.set('huge', pdf(50));

  assert.equal(cache.get('huge'), undefined);
  assert.ok(cache.get('small'), 'one oversized document must not flush everything else');
});

test('re-setting a key does not double-count its bytes', () => {
  const cache = new ResultCache({ maxBytes: 100 * 1024, ttlMs: 60_000 });
  cache.set('a', pdf(10, 1));
  cache.set('a', pdf(10, 2));

  assert.equal(cache.stats.entries, 1);
  assert.equal(cache.stats.bytes, 10 * 1024);
  assert.equal(cache.get('a')?.[0], 2, 'the newer render wins');
});

test('maxBytes 0 disables the cache entirely', () => {
  const cache = new ResultCache({ maxBytes: 0, ttlMs: 60_000 });
  cache.set('a', pdf(1));
  assert.equal(cache.get('a'), undefined);
  assert.equal(cache.stats.bytes, 0);
});
