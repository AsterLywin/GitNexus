import { MutationCoordinator } from "../../app/mutationCoordinator";
import { GitProcessExecutor } from "../../git/processExecutor";

export interface ConflictFile {
  path: string;
  ours: string;
  theirs: string;
  stage1?: string;
  stage2?: string;
  stage3?: string;
}

export class ConflictService {
  constructor(
    private readonly executor: GitProcessExecutor,
    private readonly mutation?: MutationCoordinator
  ) {}

  async list(root: string): Promise<ConflictFile[]> {
    const result = await this.executor.exec(
      ["ls-files", "-u", "-z"],
      { cwd: root, timeoutMs: 10000 }
    );

    const byPath = new Map<string, ConflictFile>();

    for (const record of result.stdout.split("\0")) {
      if (!record) continue;
      const tab = record.indexOf("\t");
      if (tab < 0) continue;

      const meta = record.slice(0, tab).split(/\s+/);
      const path = record.slice(tab + 1);
      const stage = Number(meta[3]);
      const objectId = meta[1];
      const current = byPath.get(path) ?? { path, ours: "", theirs: "" };

      if (stage === 1) current.stage1 = objectId;
      if (stage === 2) {
        current.stage2 = objectId;
        current.ours = path;
      }
      if (stage === 3) {
        current.stage3 = objectId;
        current.theirs = path;
      }

      byPath.set(path, current);
    }

    return [...byPath.values()];
  }

  async checkoutSide(root: string, path: string, side: "ours" | "theirs"): Promise<void> {
    const args = ["checkout", `--${side}`, "--", path];
    if (this.mutation) {
      await this.mutation.run({
        rootUri: root, operation: "checkout", args, allowDuringConflict: true
      });
      return;
    }
    await this.executor.exec(args, { cwd: root, timeoutMs: 30000 });
  }

  async stage(root: string, path: string): Promise<void> {
    const args = ["add", "--", path];
    if (this.mutation) {
      await this.mutation.run({
        rootUri: root, operation: "stage", args, allowDuringConflict: true
      });
      return;
    }
    await this.executor.exec(args, { cwd: root, timeoutMs: 30000 });
  }
}
