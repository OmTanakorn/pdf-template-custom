import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OverloadError, RenderGate } from '../src/gate.ts';

/** A task that resolves only when `release()` is called. */
function deferred<T = string>() {
  let release!: (value: T) => void;
  let fail!: (err: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    release = res;
    fail = rej;
  });
  return { promise, release, fail };
}

test('never runs more than `limit` tasks at once', async () => {
  const gate = new RenderGate({ limit: 2, maxQueue: 10 });
  let running = 0;
  let peak = 0;
  const tick = async () => {
    running++;
    peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, 5));
    running--;
    return 'ok';
  };

  await Promise.all(Array.from({ length: 12 }, (_, i) => gate.run(`k${i}`, tick)));

  assert.equal(peak, 2);
  assert.equal(gate.stats.active, 0);
  assert.equal(gate.stats.queued, 0);
});

test('joins identical work already in flight instead of repeating it', async () => {
  const gate = new RenderGate({ limit: 4 });
  const gated = deferred();
  let calls = 0;
  const task = () => {
    calls++;
    return gated.promise;
  };

  const all = Promise.all([gate.run('same', task), gate.run('same', task), gate.run('same', task)]);
  gated.release('pdf');

  assert.deepEqual(await all, ['pdf', 'pdf', 'pdf']);
  assert.equal(calls, 1, 'the burst should cost a single render');
  assert.equal(gate.stats.deduped, 2);
});

test('a duplicate burst consumes no queue slots', async () => {
  const gate = new RenderGate({ limit: 1, maxQueue: 1 });
  const first = deferred();
  const second = deferred();

  const busy = gate.run('a', () => first.promise); // takes the only slot
  const queued = gate.run('b', () => second.promise); // takes the only queue slot
  // 20 more clicks on the same button as the in-flight render: all dedupe.
  const dupes = Array.from({ length: 20 }, () => gate.run('a', () => first.promise));
  assert.equal(gate.stats.queued, 1);
  assert.equal(gate.stats.rejected, 0);

  first.release('one');
  second.release('two');
  assert.deepEqual(await Promise.all([busy, queued, ...dupes]), ['one', 'two', ...Array(20).fill('one')]);
});

test('rejects with 503 once the queue is full', async () => {
  const gate = new RenderGate({ limit: 1, maxQueue: 1 });
  const held = deferred();
  const running = gate.run('a', () => held.promise);
  const waiting = gate.run('b', () => held.promise);

  const err = await gate.run('c', () => held.promise).then(
    () => null,
    (e: unknown) => e,
  );
  assert.ok(err instanceof OverloadError);
  assert.equal(err.status, 503);
  assert.ok(err.retryAfter >= 1, 'clients need a Retry-After to back off with');
  assert.equal(gate.stats.rejected, 1);

  held.release('done');
  await Promise.all([running, waiting]);
});

test('gives up on a caller that waited past the timeout', async () => {
  const gate = new RenderGate({ limit: 1, maxQueue: 5, queueTimeoutMs: 10 });
  const held = deferred();
  const running = gate.run('a', () => held.promise);

  await assert.rejects(
    gate.run('b', async () => 'never'),
    (err: unknown) => err instanceof OverloadError && /Timed out/.test(err.message),
  );
  assert.equal(gate.stats.queued, 0, 'the timed-out waiter is removed from the queue');

  held.release('done');
  await running;
});

test('a failed task releases its slot and clears the dedupe entry', async () => {
  const gate = new RenderGate({ limit: 1, maxQueue: 5 });

  await assert.rejects(
    gate.run('a', async () => {
      throw new Error('chromium exploded');
    }),
    /chromium exploded/,
  );
  assert.equal(gate.stats.active, 0);

  // Same key must be runnable again — the failure is not cached.
  assert.equal(await gate.run('a', async () => 'recovered'), 'recovered');
});

test('drain fails everyone still waiting', async () => {
  const gate = new RenderGate({ limit: 1, maxQueue: 5 });
  const held = deferred();
  const running = gate.run('a', () => held.promise);
  const waiting = gate.run('b', async () => 'never');

  gate.drain();
  await assert.rejects(waiting, (err: unknown) => err instanceof OverloadError && /shutting down/.test(err.message));

  held.release('done');
  await running;
});
