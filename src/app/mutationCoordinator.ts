import { OperationState, GitOperation } from "../domain/operation";
import { GitProcessExecutor } from "../git/processExecutor";
import { RepositoryOperationDetector } from "../git/repositoryOperationDetector";
import { OperationJournal } from "../state/operationJournal";
import { RepositoryLock } from "../state/repositoryLock";

/**
 * Thrown when a destructive mutation's precondition no longer holds —
 * the repository changed unexpectedly between read and mutate
 * (REPOSITORY_STATE_MODEL §23–§24). The caller must surface a
 * state-conflict result and let the user decide on a retry.
 */
export class StateConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StateConflictError";
  }
}

export interface MutationContext {
  rootUri: string;
  operation: GitOperation;
  args: readonly string[];
  timeoutMs?: number;
  signal?: AbortSignal;
  env?: Record<string, string | undefined>;
  /**
   * Precondition (§24): the HEAD commit the caller observed when it decided
   * to mutate. If HEAD has moved since, the mutation is refused with a
   * StateConflictError instead of running against unexpected state.
   */
  expectHead?: string;
  /** Repository generation the caller based its decision on (journal). */
  generation?: number;
  /**
   * This mutation is itself a conflict-resolution step (checkout
   * --ours/--theirs, staging a resolved file, continue/abort). Such steps
   * are legal — required, in fact — while the repository is conflicted,
   * so the conflict guards are skipped for them.
   */
  allowDuringConflict?: boolean;
}

/**
 * The mutation pipeline (GIT_ENGINE_SPEC §24, State Model §25): validate →
 * acquire the per-repository lock → check preconditions → capture
 * pre-state → execute → capture post-state → journal → release.
 * All feature mutations must pass through here.
 */
export class MutationCoordinator {
  private readonly locks = new Map<string, RepositoryLock>();
  private readonly states = new Map<string, OperationState>();

  constructor(
    private readonly executor: GitProcessExecutor,
    private readonly detector: RepositoryOperationDetector,
    private readonly journal?: OperationJournal
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
    const journalId = this.journal?.begin({
      type: context.operation,
      repo: context.rootUri,
      preGeneration: context.generation ?? 0
    });

    this.states.set(context.rootUri, {
      operation: context.operation,
      phase: "validating",
      rootUri: context.rootUri,
      startedAt,
      command: `git ${context.args[0] ?? ""}`.trim(),
      conflictPaths: [],
      generation: startedAt
    });

    try {
      if (context.expectHead) {
        const head = await this.executor.exec(["rev-parse", "HEAD"], {
          cwd: context.rootUri,
          timeoutMs: 10000
        }).then(r => r.stdout.trim()).catch(() => undefined);
        if (head !== context.expectHead) {
          throw new StateConflictError(
            `Repository HEAD changed unexpectedly (expected ${context.expectHead}, found ${head ?? "none"}). Refresh and retry.`
          );
        }
      }

      const before = await this.detector.detect(context.rootUri);
      if (before.phase === "conflict" && !context.allowDuringConflict) {
        throw new Error(`Repository already has unresolved conflicts: ${before.conflictPaths.join(", ")}`);
      }

      this.update(context.rootUri, { phase: "running" });

      await this.executor.exec(context.args, {
        cwd: context.rootUri,
        timeoutMs: context.timeoutMs ?? 60000,
        signal: context.signal,
        env: context.env as NodeJS.ProcessEnv | undefined
      });

      const after = await this.detector.detect(context.rootUri);
      if (after.phase === "conflict" && !context.allowDuringConflict) {
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
      if (journalId) this.journal?.complete(journalId);
    } catch (error) {
      const current = this.states.get(context.rootUri);
      if (current?.phase !== "conflict") {
        this.update(context.rootUri, {
          phase: context.signal?.aborted ? "cancelled" : "failed",
          finishedAt: Date.now(),
          message: error instanceof Error ? error.message : String(error)
        });
      }
      if (journalId) {
        if (context.signal?.aborted) this.journal?.cancel(journalId);
        else this.journal?.fail(journalId);
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
