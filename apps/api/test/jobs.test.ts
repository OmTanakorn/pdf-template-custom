import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JobStore } from '../src/jobs.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('walks a job from queued to done and reports timings', async () => {
  const store = new JobStore();
  const job = store.create('invoice');
  assert.equal(store.status(job).state, 'queued');

  store.started(job);
  assert.equal(store.status(job).state, 'running');

  await sleep(5);
  store.succeeded(job, new Uint8Array(2048));

  const status = store.status(job);
  assert.equal(status.state, 'done');
  assert.equal(status.name, 'invoice');
  assert.equal(status.bytes, 2048);
  assert.ok(status.renderMs !== undefined && status.renderMs >= 4);
});

test('a failed job keeps its message and any retry hint', () => {
  const store = new JobStore();
  const job = store.create('invoice');
  store.started(job);
  store.failed(job, 'Render queue is full', 3);

  const status = store.status(job);
  assert.equal(status.state, 'error');
  assert.equal(status.error, 'Render queue is full');
  assert.equal(status.retryAfter, 3);
  assert.equal(status.bytes, undefined);
});

test('ids are unique per job', () => {
  const store = new JobStore();
  const ids = new Set(Array.from({ length: 50 }, () => store.create('x').id));
  assert.equal(ids.size, 50);
});

test('a finished job stops being fetchable after its TTL', async () => {
  const store = new JobStore({ ttlMs: 20 });
  const job = store.create('invoice');
  store.started(job);
  store.succeeded(job, new Uint8Array(10));
  assert.ok(store.get(job.id));

  await sleep(30);
  assert.equal(store.get(job.id), undefined);
});

test('an unfinished job never expires out from under its render', async () => {
  const store = new JobStore({ ttlMs: 10 });
  const job = store.create('invoice');
  store.started(job);

  await sleep(30);
  assert.ok(store.get(job.id), 'a running render must still have somewhere to put its result');
});

test('over the cap, finished jobs are dropped and running ones are kept', () => {
  const store = new JobStore({ maxJobs: 5, ttlMs: 60_000 });
  const running = store.create('long');
  store.started(running);

  for (let i = 0; i < 20; i++) {
    const job = store.create(`done-${i}`);
    store.started(job);
    store.succeeded(job, new Uint8Array(10));
  }
  store.create('trigger-sweep');

  assert.ok(store.size <= 6, `expected the store to stay bounded, saw ${store.size}`);
  assert.ok(store.get(running.id), 'the in-flight job must survive the sweep');
});

test('an unknown id reads as missing rather than throwing', () => {
  assert.equal(new JobStore().get('nope'), undefined);
});
