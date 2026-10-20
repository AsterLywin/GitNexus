import { EventEmitter } from "node:events";
import { RepositorySnapshot } from "../domain/git";
import { StateDomain } from "../domain/state";

/**
 * Snapshot store (REPOSITORY_STATE_MODEL §36). Holds the latest coherent
 * snapshot per repository worktree; authoritative state is always
 * reconstructible from Git — the store is a cache, never the source of truth.
 */
export class RepositoryStateStore {
  private readonly snapshots = new Map<string, RepositorySnapshot>();
  private readonly events = new EventEmitter();

  get(rootUri: string): RepositorySnapshot | undefined {
    return this.snapshots.get(rootUri);
  }

  set(snapshot: RepositorySnapshot): void {
    this.snapshots.set(snapshot.identity.rootUri, snapshot);
    this.events.emit("changed", snapshot);
  }

  delete(rootUri: string): void {
    this.snapshots.delete(rootUri);
  }

  /** All snapshots sharing a common Git directory (multi-worktree, §26). */
  byCommonDir(commonDir: string): RepositorySnapshot[] {
    return [...this.snapshots.values()].filter(
      s => (s.identity.commonDir ?? s.identity.gitDir) === commonDir
    );
  }

  /**
   * Mark domains of a snapshot as potentially stale (§13–§14) without
   * discarding their values — consumers can show last-known state with a
   * staleness hint until the next refresh lands.
   */
  markStale(rootUri: string, domains: StateDomain[]): void {
    const snapshot = this.snapshots.get(rootUri);
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
