import * as path from "node:path";
import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import { RepositoryStateStore, normalizeRootPath } from "../../state/repositoryStateStore";
import { BlameLine, BlameService } from "./blameService";

export interface BlameTarget {
  /** Canonical repository root (Git's spelling). */
  root: string;
  /** Repository-relative path with forward slashes, as Git expects it. */
  relativePath: string;
}

/**
 * Resolve a filesystem path to the repository snapshot that contains it.
 * Snapshot roots are canonical (Git spelling); the incoming path may use
 * any spelling, so the comparison runs on normalized forms.
 */
export function resolveBlameTarget(store: RepositoryStateStore, fsPath: string): BlameTarget | undefined {
  const normalized = normalizeRootPath(fsPath);
  for (const snapshot of store.all()) {
    const root = normalizeRootPath(snapshot.identity.rootUri);
    if (normalized === root) continue; // the root itself is not a file
    if (normalized.startsWith(root + "/")) {
      return { root: snapshot.identity.rootUri, relativePath: normalized.slice(root.length + 1) };
    }
  }
  return undefined;
}

interface CacheEntry {
  generation: number;
  /** Disk fingerprint at fetch time — a saved edit invalidates even when
   *  the repository generation has not moved (no commit happened). */
  mtimeMs?: number;
  size?: number;
  lines?: BlameLine[];
  pending?: Promise<BlameLine[]>;
}

/**
 * Shared blame results for the annotation controllers and the CodeLens
 * provider. Entries are keyed by canonical root + relative path and are
 * dropped as soon as the repository snapshot generation moves on, so a
 * commit/stash/checkout never leaves stale attributions on screen.
 */
export class BlameCache {
  private readonly entries = new Map<string, CacheEntry>();
  /** Buffer blames keyed by content hash — self-invalidating by construction. */
  private readonly bufferEntries = new Map<string, Promise<BlameLine[]>>();

  constructor(
    private readonly blame: BlameService,
    private readonly store: RepositoryStateStore
  ) {
    store.onChanged(snapshot => {
      const root = normalizeRootPath(snapshot.identity.rootUri);
      for (const key of [...this.entries.keys()]) {
        if (key.startsWith(root + "\n")) this.entries.delete(key);
      }
    });
  }

  targetFor(fsPath: string): BlameTarget | undefined {
    return resolveBlameTarget(this.store, fsPath);
  }

  /** Remote URLs of a repository (autolink rule assembly). */
  remoteUrlsFor(root: string): string[] {
    const remotes = this.store.get(root)?.domains?.remotes ?? [];
    return remotes.flatMap(remote => [remote.fetchUrl, remote.pushUrl].filter((u): u is string => Boolean(u)));
  }

  static relativeOf(root: string, fsPath: string): string {
    return path.relative(root, fsPath).split(path.sep).join("/");
  }

  async get(root: string, relativePath: string): Promise<BlameLine[]> {
    const generation = this.store.get(root)?.generation ?? 0;
    const key = `${normalizeRootPath(root)}\n${relativePath}`;
    const fingerprint = await stat(path.join(root, relativePath)).then(
      s => ({ mtimeMs: s.mtimeMs, size: s.size }),
      () => undefined
    );
    const existing = this.entries.get(key);
    const fresh = existing !== undefined
      && existing.generation === generation
      && (fingerprint === undefined
        || (existing.mtimeMs === fingerprint.mtimeMs && existing.size === fingerprint.size));
    if (existing && fresh && existing.lines) return existing.lines;
    if (existing && fresh && existing.pending) return existing.pending;

    const pending = this.blame.blame(root, relativePath).then(lines => {
      const entry = this.entries.get(key);
      if (entry?.pending === pending) {
        this.entries.set(key, { generation, mtimeMs: fingerprint?.mtimeMs, size: fingerprint?.size, lines });
      }
      return lines;
    }, (error: unknown) => {
      this.entries.delete(key);
      throw error;
    });
    this.entries.set(key, { generation, mtimeMs: fingerprint?.mtimeMs, size: fingerprint?.size, pending });
    return pending;
  }

  /**
   * Blame for an in-memory buffer (dirty editor). Identical content hits
   * the cache; any keystroke changes the hash and therefore the entry.
   */
  async getBuffer(root: string, relativePath: string, content: string): Promise<BlameLine[]> {
    const hash = createHash("sha1").update(content).digest("hex");
    const key = `${normalizeRootPath(root)}\n${relativePath}\n${hash}`;
    const existing = this.bufferEntries.get(key);
    if (existing) return existing;
    const pending = this.blame.blameBuffer(root, relativePath, content).catch((error: unknown) => {
      this.bufferEntries.delete(key);
      throw error;
    });
    this.bufferEntries.set(key, pending);
    // Keep only the most recent handful of buffer snapshots.
    while (this.bufferEntries.size > 16) {
      const oldest = this.bufferEntries.keys().next().value;
      if (oldest === undefined) break;
      this.bufferEntries.delete(oldest);
    }
    return pending;
  }

  invalidate(root: string, relativePath?: string): void {
    const prefix = `${normalizeRootPath(root)}\n`;
    for (const key of [...this.entries.keys()]) {
      if (key.startsWith(prefix) && (!relativePath || key === prefix + relativePath)) {
        this.entries.delete(key);
      }
    }
  }
}
