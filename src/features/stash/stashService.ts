import { GitProcessExecutor } from "../../git/processExecutor";

export interface StashEntry { index: number; ref: string; subject: string; }

export class StashService {
  constructor(private readonly executor: GitProcessExecutor, private readonly timeoutMs = 30000) {}

  async list(root: string): Promise<StashEntry[]> {
    const r = await this.executor.exec(["stash", "list", "--format=%gd%x1f%s"], { cwd: root, timeoutMs: this.timeoutMs });
    return r.stdout.split(/\r?\n/).filter(Boolean).map((line, index) => {
      const [ref, subject] = line.split("\x1f");
      return { index, ref, subject };
    });
  }

  /** Full patch of a stash entry (`git stash show -p`). */
  async show(root: string, ref: string): Promise<string> {
    const result = await this.executor.exec(["stash", "show", "-p", ref], { cwd: root, timeoutMs: this.timeoutMs });
    return result.stdout;
  }

  async push(root: string, message?: string, includeUntracked = false): Promise<void> {
    await this.executor.exec(["stash", "push", ...(includeUntracked ? ["--include-untracked"] : []), ...(message ? ["-m", message] : [])], { cwd: root, timeoutMs: this.timeoutMs });
  }

  async pop(root: string, index = 0): Promise<void> {
    await this.executor.exec(["stash", "pop", `stash@{${index}}`], { cwd: root, timeoutMs: this.timeoutMs });
  }

  async apply(root: string, index = 0): Promise<void> {
    await this.executor.exec(["stash", "apply", `stash@{${index}}`], { cwd: root, timeoutMs: this.timeoutMs });
  }

  async drop(root: string, index = 0): Promise<void> {
    await this.executor.exec(["stash", "drop", `stash@{${index}}`], { cwd: root, timeoutMs: this.timeoutMs });
  }
}
