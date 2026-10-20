import { GitProcessExecutor } from "./processExecutor";

export interface CherryPickOptions {
  noCommit?: boolean;
  mainline?: number;
  allowEmpty?: boolean;
}

/** Cherry-pick operations (GIT_ENGINE_SPEC §18). */
export class CherryPickService {
  constructor(
    private readonly executor: GitProcessExecutor,
    private readonly timeoutMs = 60000
  ) {}

  async pick(root: string, commits: string[], options: CherryPickOptions = {}): Promise<void> {
    const args = ["cherry-pick"];
    if (options.noCommit) args.push("--no-commit");
    if (options.mainline) args.push("-m", String(options.mainline));
    if (options.allowEmpty) args.push("--allow-empty");
    args.push(...commits);
    await this.executor.exec(args, { cwd: root, timeoutMs: this.timeoutMs });
  }

  async continue(root: string): Promise<void> {
    await this.executor.exec(["cherry-pick", "--continue"], {
      cwd: root,
      timeoutMs: this.timeoutMs,
      env: { GIT_EDITOR: "true" }
    });
  }

  async skip(root: string): Promise<void> {
    await this.executor.exec(["cherry-pick", "--skip"], { cwd: root, timeoutMs: this.timeoutMs });
  }

  async abort(root: string): Promise<void> {
    await this.executor.exec(["cherry-pick", "--abort"], { cwd: root, timeoutMs: this.timeoutMs });
  }

  async quit(root: string): Promise<void> {
    await this.executor.exec(["cherry-pick", "--quit"], { cwd: root, timeoutMs: this.timeoutMs });
  }
}
