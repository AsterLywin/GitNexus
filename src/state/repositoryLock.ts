export class RepositoryLock {
  private owner?: string;
  private queue: Promise<void> = Promise.resolve();

  async acquire(owner: string): Promise<() => void> {
    let releaseQueue!: () => void;
    const next = new Promise<void>(resolve => { releaseQueue = resolve; });
    const previous = this.queue;
    this.queue = previous.then(() => next);

    await previous;
    this.owner = owner;

    return () => {
      if (this.owner === owner) this.owner = undefined;
      releaseQueue();
    };
  }

  get currentOwner(): string | undefined {
    return this.owner;
  }
}
