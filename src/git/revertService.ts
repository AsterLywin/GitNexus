import { GitProcessExecutor } from "./processExecutor";

export interface RevertOptions {
  noCommit?: boolean;
  mainline?: number;
}

/** Revert operations (GIT_ENGINE_SPEC §18). */
export class RevertService {
  constructor(
    private readonly executor: GitProcessExecutor,
    private readonly timeoutMs = 60000
  ) {}

  async revert(root: string, commits: string[], options: RevertOptions = {}): Promise<void> {
    const args = ["revert"];
    if (options.noCommit) args.push("--no-commit");
    if (options.mainline) args.push("-m", String(options.mainline));
    args.push(...commits);
    await this.executor.exec(args, {
      cwd: root,
      timeoutMs: this.timeoutMs,
      env: { GIT_EDITOR: "true" }
    });
  }

  async continue(root: string): Promise<void> {
    await this.executor.exec(["revert", "--continue"], {
      cwd: root,
      timeoutMs: this.timeoutMs,
      env: { GIT_EDITOR: "true" }
    });
  }

  async skip(root: string): Promise<void> {
    await this.executor.exec(["revert", "--skip"], { cwd: root, timeoutMs: this.timeoutMs });
  }

  async abort(root: string): Promise<void> {
    await this.executor.exec(["revert", "--abort"], { cwd: root, timeoutMs: this.timeoutMs });
  }
}
