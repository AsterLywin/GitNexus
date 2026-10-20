import { GitProcessExecutor } from "../../git/processExecutor";

export interface DiffFile {
  path: string;
  oldPath?: string;
  status: "added" | "modified" | "deleted" | "renamed" | "unknown";
  additions: number;
  deletions: number;
  patch: string;
}

export interface DiffResult {
  files: DiffFile[];
  rawPatch: string;
}

export class DiffService {
  constructor(
    private readonly executor: GitProcessExecutor,
    private readonly timeoutMs = 30000
  ) {}

  async diff(root: string, args: readonly string[] = []): Promise<DiffResult> {
    const result = await this.executor.exec(
      ["diff", "--no-ext-diff", "--unified=3", ...args],
      { cwd: root, timeoutMs: this.timeoutMs }
    );

    return {
      files: parseFiles(result.stdout),
      rawPatch: result.stdout
    };
  }

  /** Working-tree (unstaged) diff, optionally for a single file. */
  async workingTree(root: string, file?: string): Promise<DiffResult> {
    return this.diff(root, file ? ["--", file] : []);
  }

  /** Staged (index vs HEAD) diff, optionally for a single file. */
  async staged(root: string, file?: string): Promise<DiffResult> {
    return this.diff(root, ["--staged", ...(file ? ["--", file] : [])]);
  }

  /** Diff introduced by a single commit (uses `git show` so root commits work). */
  async commit(root: string, commitId: string): Promise<DiffResult> {
    const result = await this.executor.exec(
      ["show", "--no-ext-diff", "--unified=3", "--format=", commitId],
      { cwd: root, timeoutMs: this.timeoutMs }
    );
    return { files: parseFiles(result.stdout), rawPatch: result.stdout };
  }

  /** Diff between two revisions; three-dot (merge-base) by default. */
  async range(root: string, from: string, to: string, threeDot = true): Promise<DiffResult> {
    return this.diff(root, [`${from}${threeDot ? "..." : ".."}${to}`]);
  }

  /** Word-level diff for a file (prose-friendly). */
  async wordDiff(root: string, file: string, staged = false): Promise<DiffResult> {
    return this.diff(root, [
      "--word-diff=plain",
      ...(staged ? ["--staged"] : []),
      "--", file
    ]);
  }

  /** Name/status-only summary (binary files are reported, not expanded). */
  async nameStatus(root: string, args: readonly string[] = []): Promise<Array<{ status: string; path: string; oldPath?: string }>> {
    const result = await this.executor.exec(
      ["diff", "--name-status", "-z", ...args],
      { cwd: root, timeoutMs: this.timeoutMs }
    );
    const fields = result.stdout.split("\0").filter(Boolean);
    const entries: Array<{ status: string; path: string; oldPath?: string }> = [];
    for (let i = 0; i < fields.length; i++) {
      const status = fields[i];
      if (/^[RC]/.test(status)) {
        entries.push({ status, oldPath: fields[++i], path: fields[++i] });
      } else {
        entries.push({ status, path: fields[++i] });
      }
    }
    return entries;
  }
}

function parseFiles(patch: string): DiffFile[] {
  const chunks = patch.split(/^diff --git /m).filter(Boolean);
  return chunks.map(chunk => {
    const lines = chunk.split(/\r?\n/);
    const header = lines[0] ?? "";
    const paths = header.match(/a\/(.+?) b\/(.+)$/);
    const path = paths?.[2] ?? paths?.[1] ?? "unknown";

    let status: DiffFile["status"] = "modified";
    if (/^new file mode/m.test(chunk)) status = "added";
    else if (/^deleted file mode/m.test(chunk)) status = "deleted";
    else if (/^similarity index/m.test(chunk)) status = "renamed";

    const additions = lines.filter(line => line.startsWith("+") && !line.startsWith("+++")).length;
    const deletions = lines.filter(line => line.startsWith("-") && !line.startsWith("---")).length;

    return {
      path,
      status,
      additions,
      deletions,
      patch: `diff --git ${chunk}`
    };
  });
}
