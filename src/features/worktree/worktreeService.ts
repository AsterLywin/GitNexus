import { GitProcessExecutor } from "../../git/processExecutor";

export interface Worktree {
  path: string;
  head?: string;
  branch?: string;
  detached: boolean;
  locked: boolean;
  prunable: boolean;
}

export class WorktreeService {
  constructor(
    private readonly executor: GitProcessExecutor,
    private readonly timeoutMs = 30000
  ) {}

  async list(root: string): Promise<Worktree[]> {
    const result = await this.executor.exec(
      ["worktree", "list", "--porcelain"],
      { cwd: root, timeoutMs: this.timeoutMs }
    );
    return parseWorktrees(result.stdout);
  }

  async add(root: string, path: string, ref?: string): Promise<void> {
    const args = ["worktree", "add", path];
    if (ref) args.push(ref);
    await this.executor.exec(args, { cwd: root, timeoutMs: this.timeoutMs });
  }

  async remove(root: string, path: string, force = false): Promise<void> {
    await this.executor.exec(
      ["worktree", "remove", ...(force ? ["--force"] : []), path],
      { cwd: root, timeoutMs: this.timeoutMs }
    );
  }

  async move(root: string, from: string, to: string): Promise<void> {
    await this.executor.exec(["worktree", "move", from, to], { cwd: root, timeoutMs: this.timeoutMs });
  }

  async lock(root: string, path: string, reason?: string): Promise<void> {
    await this.executor.exec(
      ["worktree", "lock", ...(reason ? ["--reason", reason] : []), path],
      { cwd: root, timeoutMs: this.timeoutMs }
    );
  }

  async unlock(root: string, path: string): Promise<void> {
    await this.executor.exec(["worktree", "unlock", path], { cwd: root, timeoutMs: this.timeoutMs });
  }

  async prune(root: string, dryRun = false): Promise<void> {
    await this.executor.exec(
      ["worktree", "prune", ...(dryRun ? ["--dry-run"] : [])],
      { cwd: root, timeoutMs: this.timeoutMs }
    );
  }
}

export { parseWorktrees };

function parseWorktrees(raw: string): Worktree[] {
  const blocks = raw.split(/\n\n+/).filter(Boolean);
  return blocks.map(block => {
    const lines = block.split(/\r?\n/);
    const path = lines.find(x => x.startsWith("worktree "))?.slice(9) ?? "";
    const head = lines.find(x => x.startsWith("HEAD "))?.slice(5);
    const branch = lines.find(x => x.startsWith("branch "))?.slice(7);
    return {
      path,
      head,
      branch,
      detached: lines.some(x => x === "detached"),
      locked: lines.some(x => x === "locked"),
      prunable: lines.some(x => x === "prunable")
    };
  });
}
