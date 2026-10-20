import { EventEmitter } from "node:events";
import { RepositorySnapshot } from "../domain/git";

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

  onChanged(listener: (snapshot: RepositorySnapshot) => void): () => void {
    this.events.on("changed", listener);
    return () => this.events.off("changed", listener);
  }
}
