import { GitProcessExecutor } from "./processExecutor";
import { OperationPhase } from "../domain/operation";

export interface DetectedOperation {
  phase: OperationPhase;
  operation?: "rebase" | "merge" | "cherry-pick";
  conflictPaths: string[];
}

export class RepositoryOperationDetector {
  constructor(
    private readonly executor: GitProcessExecutor,
    private readonly timeoutMs = 10000
  ) {}

  async detect(root: string): Promise<DetectedOperation> {
    const [status, rebaseMerge, rebaseApply, mergeHead, cherryPick] = await Promise.all([
      this.executor.exec(["status", "--porcelain=v2", "-z"], { cwd: root, timeoutMs: this.timeoutMs }),
      this.pathExists(root, ["rev-parse", "--git-path", "rebase-merge"]),
      this.pathExists(root, ["rev-parse", "--git-path", "rebase-apply"]),
      this.pathExists(root, ["rev-parse", "--git-path", "MERGE_HEAD"]),
      this.pathExists(root, ["rev-parse", "--git-path", "CHERRY_PICK_HEAD"])
    ]);

    const conflicts = parseConflicts(status.stdout);
    if (rebaseMerge || rebaseApply) {
      return { phase: conflicts.length ? "conflict" : "running", operation: "rebase", conflictPaths: conflicts };
    }
    if (mergeHead) {
      return { phase: conflicts.length ? "conflict" : "running", operation: "merge", conflictPaths: conflicts };
    }
    if (cherryPick) {
      return { phase: conflicts.length ? "conflict" : "running", operation: "cherry-pick", conflictPaths: conflicts };
    }
    return { phase: "idle", conflictPaths: [] };
  }

  private async pathExists(root: string, args: string[]): Promise<boolean> {
    try {
      const result = await this.executor.exec(args, { cwd: root, timeoutMs: this.timeoutMs });
      const gitPath = result.stdout.trim();
      if (!gitPath) return false;
      // `git rev-parse --git-path` returns a path relative to the
      // repository root (e.g. ".git/MERGE_HEAD") — resolve it against the
      // root, never against this process's working directory.
      const { access } = await import("node:fs/promises");
      const { isAbsolute, join } = await import("node:path");
      await access(isAbsolute(gitPath) ? gitPath : join(root, gitPath));
      return true;
    } catch {
      return false;
    }
  }
}

function parseConflicts(raw: string): string[] {
  const paths: string[] = [];
  for (const record of raw.split("\0")) {
    if (!record) continue;
    if (record.startsWith("u ")) {
      const fields = record.split(" ");
      const path = fields.slice(10).join(" ");
      if (path) paths.push(path);
    }
  }
  return [...new Set(paths)];
}
