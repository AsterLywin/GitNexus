import { GitProcessExecutor } from "../../git/processExecutor";

export interface CompareResult {
  base: string;
  target: string;
  patch: string;
  changedFiles: string[];
}

export class CompareService {
  constructor(
    private readonly executor: GitProcessExecutor,
    private readonly timeoutMs = 30000
  ) {}

  async compare(root: string, base: string, target: string): Promise<CompareResult> {
    const patch = await this.executor.exec(
      ["diff", "--no-ext-diff", "--unified=3", `${base}...${target}`],
      { cwd: root, timeoutMs: this.timeoutMs }
    );

    const names = await this.executor.exec(
      ["diff", "--name-only", `${base}...${target}`],
      { cwd: root, timeoutMs: this.timeoutMs }
    );

    return {
      base,
      target,
      patch: patch.stdout,
      changedFiles: names.stdout.split(/\r?\n/).filter(Boolean)
    };
  }
}
