/**
 * Short-lived LRU for rendered PDFs, keyed by a hash of the request body.
 *
 * The gate dedupes work that is *in flight*; this covers the gap right after
 * one finishes — a user who clicks Export again three seconds later would
 * otherwise pay for a second identical render.
 *
 * Safe because a render is a pure function of template + data: the binding
 * language reads dates out of the data, never off the clock. A custom filter
 * registered through `registerFilter` could break that assumption, so keep the
 * TTL short enough that a stale answer is cheap.
 *
 * Bounded in bytes rather than entries: a PDF is anywhere from 20KB to several
 * MB, so an entry count says nothing useful about memory.
 */

interface Entry {
  value: Uint8Array;
  expiresAt: number;
}

export interface CacheOptions {
  /** Total bytes of cached PDFs to hold. `0` disables the cache. */
  maxBytes: number;
  /** How long an entry stays servable. */
  ttlMs: number;
}

export interface CacheStats {
  entries: number;
  bytes: number;
  hits: number;
  misses: number;
  evictions: number;
}

export class ResultCache {
  // Map iterates in insertion order, which is the LRU order as long as every
  // read re-inserts its entry at the back.
  private readonly entries = new Map<string, Entry>();
  private readonly opts: CacheOptions;
  private bytes = 0;
  private hits = 0;
  private misses = 0;
  private evictions = 0;

  constructor(opts: Partial<CacheOptions> = {}) {
    this.opts = {
      maxBytes: Math.max(0, opts.maxBytes ?? 64 * 1024 * 1024),
      ttlMs: Math.max(0, opts.ttlMs ?? 60_000),
    };
  }

  get stats(): CacheStats {
    return { entries: this.entries.size, bytes: this.bytes, hits: this.hits, misses: this.misses, evictions: this.evictions };
  }

  get(key: string): Uint8Array | undefined {
    const entry = this.entries.get(key);
    if (!entry) {
      this.misses++;
      return undefined;
    }
    if (entry.expiresAt <= Date.now()) {
      this.drop(key, entry);
      this.misses++;
      return undefined;
    }
    // Re-insert so this key is the most recently used.
    this.entries.delete(key);
    this.entries.set(key, entry);
    this.hits++;
    return entry.value;
  }

  set(key: string, value: Uint8Array): void {
    // A single document larger than the whole budget would evict everything
    // else to store something nothing else can share.
    if (this.opts.maxBytes === 0 || value.byteLength > this.opts.maxBytes) return;

    const existing = this.entries.get(key);
    if (existing) this.drop(key, existing);

    this.entries.set(key, { value, expiresAt: Date.now() + this.opts.ttlMs });
    this.bytes += value.byteLength;
    this.evictToFit();
  }

  clear(): void {
    this.entries.clear();
    this.bytes = 0;
  }

  private evictToFit(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (this.bytes <= this.opts.maxBytes) {
        // Past the budget check, only keep going while the front is expired.
        if (entry.expiresAt > now) break;
      }
      this.drop(key, entry);
      this.evictions++;
    }
  }

  private drop(key: string, entry: Entry): void {
    this.entries.delete(key);
    this.bytes -= entry.value.byteLength;
  }
}
