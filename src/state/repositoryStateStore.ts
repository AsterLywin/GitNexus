import { EventEmitter } from "node:events";
import { RepositorySnapshot } from "../domain/git";
import { StateDomain } from "../domain/state";

/**
 * Canonical form for repository root keys.
 *
 * Git reports paths with forward slashes on every platform
 * (`C:/repo` on Windows), while Node and VS Code hand out native
 * separators (`C:\repo`) and an unstable drive-letter case. Without one
 * canonical form, the same repository keys differently depending on who
 * produced the path — and lookups silently miss (this broke watcher-
 * driven refresh and the SCM view on Windows).
 */
export function normalizeRootPath(path: string): string {
  let normalized = path.replace(/\\/g, "/");
  normalized = normalized.replace(/^([a-zA-Z]):\//, (_m, drive: string) => `${drive.toLowerCase()}:/`);
  return normalized.length > 1 ? normalized.replace(/\/+$/, "") : normalized;
}

/**
 * Snapshot store (REPOSITORY_STATE_MODEL §36). Holds the latest coherent
 * snapshot per repository worktree; authoritative state is always
 * reconstructible from Git — the store is a cache, never the source of truth.
 * All keys pass through normalizeRootPath.
 */
export class RepositoryStateStore {
  private readonly snapshots = new Map<string, RepositorySnapshot>();
  private readonly events = new EventEmitter();

  get(rootUri: string): RepositorySnapshot | undefined {
    return this.snapshots.get(normalizeRootPath(rootUri));
  }

  set(snapshot: RepositorySnapshot): void {
    this.snapshots.set(normalizeRootPath(snapshot.identity.rootUri), snapshot);
    this.events.emit("changed", snapshot);
  }

  delete(rootUri: string): void {
    this.snapshots.delete(normalizeRootPath(rootUri));
  }

  /** All snapshots sharing a common Git directory (multi-worktree, §26). */
  byCommonDir(commonDir: string): RepositorySnapshot[] {
    const wanted = normalizeRootPath(commonDir);
    return [...this.snapshots.values()].filter(
      s => normalizeRootPath(s.identity.commonDir ?? s.identity.gitDir) === wanted
    );
  }

  /**
   * Mark domains of a snapshot as potentially stale (§13–§14) without
   * discarding their values — consumers can show last-known state with a
   * staleness hint until the next refresh lands.
   */
  markStale(rootUri: string, domains: StateDomain[]): void {
    const snapshot = this.snapshots.get(normalizeRootPath(rootUri));
    if (!snapshot?.domains) return;
    let changed = false;
    for (const domain of domains) {
      const freshness = snapshot.domains.freshness[domain];
      if (freshness && !freshness.stale) {
        freshness.stale = true;
        changed = true;
      }
    }
    if (changed) this.events.emit("changed", snapshot);
  }

  onChanged(listener: (snapshot: RepositorySnapshot) => void): () => void {
    this.events.on("changed", listener);
    return () => this.events.off("changed", listener);
  }
}
