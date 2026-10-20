/**
 * Small TTL cache for data that is safe to reuse (GIT_ENGINE_SPEC §23):
 * Git version, capabilities, repository metadata, immutable commit metadata.
 * Working-tree status and operation state must NOT be cached here without
 * validation — they change outside GitNexus's control.
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class MetadataCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();
  private hits = 0;
  private misses = 0;

  constructor(private readonly defaultTtlMs = 60_000) {}

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) {
      this.misses++;
      return undefined;
    }
    if (Date.now() > entry.expiresAt) {
      this.entries.delete(key);
      this.misses++;
      return undefined;
    }
    this.hits++;
    return entry.value;
  }

  set(key: string, value: T, ttlMs = this.defaultTtlMs): void {
    this.entries.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  get stats(): { hits: number; misses: number; size: number } {
    return { hits: this.hits, misses: this.misses, size: this.entries.size };
  }
}
