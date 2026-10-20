/**
 * The single repository event bus (REPOSITORY_STATE_MODEL §15).
 * All state changes flow through here; feature services subscribe instead
 * of polling Git or each other.
 */

import { RepositoryStateEvent } from "../domain/state";

export type RepositoryStateListener = (rootUri: string, event: RepositoryStateEvent) => void;

export class RepositoryEventBus {
  private readonly listeners = new Set<RepositoryStateListener>();

  emit(rootUri: string, event: RepositoryStateEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(rootUri, event);
      } catch {
        // A broken subscriber must never break state publication.
      }
    }
  }

  subscribe(listener: RepositoryStateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
