/**
 * Admission control for expensive renders.
 *
 * A render costs a Chromium browser context (tens of MB, and a rasterised page
 * at `deviceScaleFactor: 2`). Node's HTTP server happily accepts every socket,
 * so without a gate a user leaning on the Export button turns N clicks into N
 * concurrent contexts and the process is OOM-killed before the first PDF is
 * written.
 *
 * Two mechanisms, in this order:
 *
 * 1. **Dedupe** — identical work already in flight is joined, not repeated.
 *    This is checked before the queue, so a burst of identical clicks costs one
 *    render and zero queue slots.
 * 2. **Semaphore + bounded queue** — at most `limit` renders run at once, at
 *    most `maxQueue` wait. Past that the caller is rejected rather than
 *    admitted into a queue it will never reach the front of; a fast 503 with
 *    `Retry-After` is a better answer than a dead server.
 */

/** Thrown when the queue is full or a caller waited past `queueTimeoutMs`. */
export class OverloadError extends Error {
  readonly status = 503;
  constructor(
    message: string,
    /** Seconds to put in the `Retry-After` header. */
    readonly retryAfter: number,
  ) {
    super(message);
    this.name = 'OverloadError';
  }
}

export interface GateOptions {
  /** Renders allowed to run at once. */
  limit: number;
  /** Renders allowed to wait for a slot. Beyond this, callers are rejected. */
  maxQueue: number;
  /** Give up on a waiting caller after this long — it has usually left. */
  queueTimeoutMs: number;
}

interface Waiter {
  admit: () => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

export interface GateStats {
  active: number;
  queued: number;
  /** Requests joined to an in-flight render instead of starting their own. */
  deduped: number;
  /** Requests turned away because the queue was full or the wait timed out. */
  rejected: number;
}

export class RenderGate {
  private readonly opts: GateOptions;
  private readonly waiting: Waiter[] = [];
  private readonly inflight = new Map<string, Promise<unknown>>();
  private active = 0;
  private deduped = 0;
  private rejected = 0;

  constructor(opts: Partial<GateOptions> = {}) {
    this.opts = {
      limit: Math.max(1, opts.limit ?? 2),
      maxQueue: Math.max(0, opts.maxQueue ?? 50),
      queueTimeoutMs: Math.max(0, opts.queueTimeoutMs ?? 20_000),
    };
  }

  get stats(): GateStats {
    return { active: this.active, queued: this.waiting.length, deduped: this.deduped, rejected: this.rejected };
  }

  /**
   * Run `task`, or join the identical `task` already running under `key`.
   * Rejects with `OverloadError` when the server has no room.
   */
  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const shared = this.inflight.get(key);
    if (shared) {
      this.deduped++;
      return shared as Promise<T>;
    }
    // Registered before the first await so a synchronous burst of duplicate
    // callers in the same tick all see the entry.
    const promise = this.admit(task).finally(() => this.inflight.delete(key));
    this.inflight.set(key, promise);
    return promise;
  }

  private admit<T>(task: () => Promise<T>): Promise<T> {
    if (this.active < this.opts.limit) return this.start(task);
    if (this.waiting.length >= this.opts.maxQueue) {
      this.rejected++;
      return Promise.reject(new OverloadError('Render queue is full', this.retryAfter()));
    }
    return new Promise<T>((resolve, reject) => {
      const waiter: Waiter = {
        admit: () => resolve(this.start(task)),
        reject,
        timer: setTimeout(() => {
          const i = this.waiting.indexOf(waiter);
          if (i >= 0) this.waiting.splice(i, 1);
          this.rejected++;
          reject(new OverloadError('Timed out waiting for a render slot', this.retryAfter()));
        }, this.opts.queueTimeoutMs),
      };
      // A timer alone must not hold the process open at shutdown.
      waiter.timer.unref?.();
      this.waiting.push(waiter);
    });
  }

  private async start<T>(task: () => Promise<T>): Promise<T> {
    this.active++;
    try {
      return await task();
    } finally {
      this.active--;
      this.next();
    }
  }

  private next(): void {
    const waiter = this.waiting.shift();
    if (!waiter) return;
    clearTimeout(waiter.timer);
    waiter.admit();
  }

  /** Rough seconds until a slot frees, so clients back off by real load. */
  private retryAfter(): number {
    const perRender = 0.5; // seconds; renders are ~150ms warm, padded for load
    return Math.max(1, Math.ceil(((this.waiting.length + 1) / this.opts.limit) * perRender));
  }

  /** Fail every waiting caller — used on shutdown. */
  drain(): void {
    while (this.waiting.length) {
      const waiter = this.waiting.pop()!;
      clearTimeout(waiter.timer);
      waiter.reject(new OverloadError('Server is shutting down', 5));
    }
  }
}
