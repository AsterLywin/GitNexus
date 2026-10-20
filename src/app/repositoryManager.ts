import { RepositoryEvent, RepositorySnapshot } from "../domain/git";
import { GitService } from "../git/gitService";
import { RepositoryStateStore } from "../state/repositoryStateStore";

export class RepositoryManager {
  private readonly listeners = new Set<(event: RepositoryEvent) => void>();

  constructor(
    private readonly git: GitService,
    private readonly store: RepositoryStateStore
  ) {}

  onEvent(listener: (event: RepositoryEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async open(path: string): Promise<RepositorySnapshot> {
    const identity = await this.git.discoverRepository(path);
    return this.refresh(identity.rootUri, identity.rootUri);
  }

  async refresh(rootUri: string, path = rootUri): Promise<RepositorySnapshot> {
    const identity = await this.git.discoverRepository(path);
    const previous = this.store.get(identity.rootUri);
    const [head, status, commits] = await Promise.all([
      this.git.head(identity.rootUri),
      this.git.status(identity.rootUri),
      this.git.log(identity.rootUri)
    ]);

    const snapshot: RepositorySnapshot = {
      identity,
      head,
      status,
      commits,
      generation: (previous?.generation ?? 0) + 1,
      updatedAt: Date.now()
    };

    this.store.set(snapshot);
    this.emit({
      type: previous ? "stateRefreshed" : "repositoryOpened",
      rootUri: identity.rootUri,
      generation: snapshot.generation,
      timestamp: snapshot.updatedAt
    });
    return snapshot;
  }

  get(rootUri: string): RepositorySnapshot | undefined {
    return this.store.get(rootUri);
  }

  private emit(event: RepositoryEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}
