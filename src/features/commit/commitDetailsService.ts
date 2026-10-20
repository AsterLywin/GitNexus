import { GitProcessExecutor } from "../../git/processExecutor";
import { CommitSummary } from "../../domain/git";

export interface CommitDetails {
  commit: CommitSummary;
  diff: string;
  files: string[];
}

export class CommitDetailsService {
  constructor(
    private readonly executor: GitProcessExecutor,
    private readonly timeoutMs = 30000
  ) {}

  async get(root: string, commitId: string): Promise<CommitDetails> {
    const meta = await this.executor.exec(
      ["show", "-s", "--format=%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%cn%x1f%ce%x1f%ct%x1f%s%x1f%b%x1e", commitId],
      { cwd: root, timeoutMs: this.timeoutMs }
    );

    const f = meta.stdout.replace(/\x1e/g, "").split("\x1f");
    const commit: CommitSummary = {
      id: f[0] ?? commitId,
      parents: (f[1] ?? "").split(" ").filter(Boolean),
      authorName: f[2] ?? "",
      authorEmail: f[3] ?? "",
      authorTimestamp: Number(f[4] ?? 0),
      committerName: f[5] ?? "",
      committerEmail: f[6] ?? "",
      committerTimestamp: Number(f[7] ?? 0),
      subject: f[8] ?? "",
      body: f[9] || undefined
    };

    const diff = await this.executor.exec(
      ["show", "--format=", "--stat", "--patch", commitId],
      { cwd: root, timeoutMs: this.timeoutMs }
    );

    const filesResult = await this.executor.exec(
      ["diff-tree", "--no-commit-id", "--name-only", "-r", commitId],
      { cwd: root, timeoutMs: this.timeoutMs }
    );

    return {
      commit,
      diff: diff.stdout,
      files: filesResult.stdout.split(/\r?\n/).filter(Boolean)
    };
  }
}
