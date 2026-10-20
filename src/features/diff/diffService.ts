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
