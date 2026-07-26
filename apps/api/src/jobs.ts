/**
 * In-memory store for async renders.
 *
 * A synchronous `POST /api/render` holds a socket for the whole render. That is
 * fine at ~150ms and wrong at ten seconds: proxies time out, the browser
 * retries, and the retry queues a second render of a document nobody is
 * waiting for any more. An async job hands back an id immediately and lets the
 * client poll, so a slow document costs one connection-second instead of ten.
 *
 * Deliberately process-local: results live as long as the process and no
 * longer. Surviving a restart means a real queue (Redis, SQS) and a worker,
 * which is a different service, not a bigger Map.
 */
import { randomUUID } from 'node:crypto';

export type JobState = 'queued' | 'running' | 'done' | 'error';

export interface Job {
  id: string;
  state: JobState;
  /** Template name, for logs and for the client to show while polling. */
  name: string;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  result?: Uint8Array;
  error?: string;
  /** Seconds to wait before retrying, when the failure was overload. */
  retryAfter?: number;
}

/** The job without its bytes — what `GET /api/jobs/:id` answers with. */
export interface JobStatus {
  id: string;
  state: JobState;
  name: string;
  queuedMs: number;
  renderMs?: number;
  bytes?: number;
  error?: string;
  retryAfter?: number;
}

export interface JobStoreOptions {
  /** How long a finished job stays fetchable. */
  ttlMs: number;
  /** Hard cap on retained jobs; the oldest finished ones go first. */
  maxJobs: number;
}

export class JobStore {
  private readonly jobs = new Map<string, Job>();
  private readonly opts: JobStoreOptions;

  constructor(opts: Partial<JobStoreOptions> = {}) {
    this.opts = {
      // No floor: the caller owns the policy. A very short TTL means results
      // expire before a client can collect them, which is its own choice.
      ttlMs: Math.max(0, opts.ttlMs ?? 5 * 60_000),
      maxJobs: Math.max(1, opts.maxJobs ?? 500),
    };
  }

  get size(): number {
    return this.jobs.size;
  }

  create(name: string): Job {
    this.sweep();
    const job: Job = { id: randomUUID(), state: 'queued', name, createdAt: Date.now() };
    this.jobs.set(job.id, job);
    return job;
  }

  get(id: string): Job | undefined {
    const job = this.jobs.get(id);
    if (!job) return undefined;
    if (this.expired(job)) {
      this.jobs.delete(id);
      return undefined;
    }
    return job;
  }

  started(job: Job): void {
    job.state = 'running';
    job.startedAt = Date.now();
  }

  succeeded(job: Job, result: Uint8Array): void {
    job.state = 'done';
    job.result = result;
    job.finishedAt = Date.now();
  }

  failed(job: Job, error: string, retryAfter?: number): void {
    job.state = 'error';
    job.error = error;
    job.finishedAt = Date.now();
    if (retryAfter !== undefined) job.retryAfter = retryAfter;
  }

  status(job: Job): JobStatus {
    const status: JobStatus = {
      id: job.id,
      state: job.state,
      name: job.name,
      queuedMs: (job.startedAt ?? Date.now()) - job.createdAt,
    };
    if (job.startedAt && job.finishedAt) status.renderMs = job.finishedAt - job.startedAt;
    if (job.result) status.bytes = job.result.byteLength;
    if (job.error) status.error = job.error;
    if (job.retryAfter !== undefined) status.retryAfter = job.retryAfter;
    return status;
  }

  /** Expire on read and on create rather than running a timer. */
  private sweep(): void {
    for (const [id, job] of this.jobs) {
      if (this.expired(job)) this.jobs.delete(id);
    }
    // Still over the cap: drop the oldest finished jobs. Running ones stay —
    // dropping them would strand a render nobody can collect.
    if (this.jobs.size <= this.opts.maxJobs) return;
    for (const [id, job] of this.jobs) {
      if (this.jobs.size <= this.opts.maxJobs) break;
      if (job.state === 'done' || job.state === 'error') this.jobs.delete(id);
    }
  }

  private expired(job: Job): boolean {
    return job.finishedAt !== undefined && Date.now() - job.finishedAt > this.opts.ttlMs;
  }
}
