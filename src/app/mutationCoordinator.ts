import { OperationState, GitOperation } from "../domain/operation";
import { GitProcessExecutor } from "../git/processExecutor";
import { RepositoryOperationDetector } from "../git/repositoryOperationDetector";
import { RepositoryLock } from "../state/repositoryLock";

export interface MutationContext {
  rootUri: string;
  operation: GitOperation;
  args: readonly string[];
  timeoutMs?: number;
  signal?: AbortSignal;
}

export class MutationCoordinator {
  private readonly locks = new Map<string, RepositoryLock>();
  private readonly states = new Map<string, OperationState>();

  constructor(
    private readonly executor: GitProcessExecutor,
    private readonly detector: RepositoryOperationDetector
  ) {}

  getState(rootUri: string): OperationState | undefined {
    return this.states.get(rootUri);
  }

  async run(context: MutationContext): Promise<void> {
    const lock = this.locks.get(context.rootUri) ?? new RepositoryLock();
    this.locks.set(context.rootUri, lock);

    const owner = `${context.operation}:${Date.now()}`;
    const release = await lock.acquire(owner);
    const startedAt = Date.now();

    this.states.set(context.rootUri, {
      operation: context.operation,
      phase: "validating",
      rootUri: context.rootUri,
      startedAt,
      command: `git ${context.args.join(" ")}`,
      conflictPaths: [],
      generation: startedAt
    });

    try {
      const before = await this.detector.detect(context.rootUri);
      if (before.phase === "conflict") {
        throw new Error(`Repository already has unresolved conflicts: ${before.conflictPaths.join(", ")}`);
      }

      this.update(context.rootUri, { phase: "running" });

      await this.executor.exec(context.args, {
        cwd: context.rootUri,
        timeoutMs: context.timeoutMs ?? 60000,
        signal: context.signal
      });

      const after = await this.detector.detect(context.rootUri);
      if (after.phase === "conflict") {
        this.update(context.rootUri, {
          phase: "conflict",
          conflictPaths: after.conflictPaths,
          finishedAt: Date.now()
        });
        throw new Error(`Git operation requires conflict resolution: ${after.conflictPaths.join(", ")}`);
      }

      this.update(context.rootUri, {
        phase: "completed",
        finishedAt: Date.now()
      });
    } catch (error) {
      const current = this.states.get(context.rootUri);
      if (current?.phase !== "conflict") {
        this.update(context.rootUri, {
          phase: context.signal?.aborted ? "cancelled" : "failed",
          finishedAt: Date.now(),
          message: error instanceof Error ? error.message : String(error)
        });
      }
      throw error;
    } finally {
      release();
    }
  }

  private update(rootUri: string, patch: Partial<OperationState>): void {
    const current = this.states.get(rootUri);
    if (!current) return;
    this.states.set(rootUri, { ...current, ...patch });
  }
}
