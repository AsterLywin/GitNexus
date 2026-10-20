import { GitProcessExecutor } from "./processExecutor";

export interface MergeOptions {
  noFf?: boolean;
  ffOnly?: boolean;
  squash?: boolean;
  message?: string;
  noCommit?: boolean;
}

/** Merge operations (GIT_ENGINE_SPEC §18). Callers must check for an active
 * incompatible operation first (RepositoryOperationDetector); Phase 2 moves
 * that check into the mutation pipeline for every caller. */
export class MergeService {
  constructor(
    private readonly executor: GitProcessExecutor,
    private readonly timeoutMs = 60000
  ) {}

  async merge(root: string, branch: string, options: MergeOptions = {}): Promise<void> {
    const args = ["merge"];
    if (options.noFf) args.push("--no-ff");
    if (options.ffOnly) args.push("--ff-only");
    if (options.squash) args.push("--squash");
    if (options.noCommit) args.push("--no-commit");
    if (options.message) args.push("-m", options.message);
    args.push(branch);
    await this.executor.exec(args, { cwd: root, timeoutMs: this.timeoutMs });
  }

  async abort(root: string): Promise<void> {
    await this.executor.exec(["merge", "--abort"], { cwd: root, timeoutMs: this.timeoutMs });
  }

  async continue(root: string): Promise<void> {
    await this.executor.exec(["merge", "--continue"], {
      cwd: root,
      timeoutMs: this.timeoutMs,
      env: { GIT_EDITOR: "true" }
    });
  }
}
