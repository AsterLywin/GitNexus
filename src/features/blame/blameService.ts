import { GitProcessExecutor } from "../../git/processExecutor";

export interface BlameLine {
  line: number;
  commit: string;
  author: string;
  timestamp: number;
  content: string;
}

export class BlameService {
  constructor(
    private readonly executor: GitProcessExecutor,
    private readonly timeoutMs = 30000
  ) {}

  async blame(root: string, file: string): Promise<BlameLine[]> {
    const result = await this.executor.exec(
      ["blame", "--line-porcelain", "--", file],
      { cwd: root, timeoutMs: this.timeoutMs }
    );
    return parseBlame(result.stdout);
  }

  /** Blame a 1-based inclusive line range (GIT_ENGINE_SPEC §14). */
  async blameRange(root: string, file: string, startLine: number, endLine: number): Promise<BlameLine[]> {
    const result = await this.executor.exec(
      ["blame", "--line-porcelain", "-L", `${startLine},${endLine}`, "--", file],
      { cwd: root, timeoutMs: this.timeoutMs }
    );
    return parseBlame(result.stdout);
  }

  /** Blame a file as of a specific revision. */
  async blameAt(root: string, file: string, revision: string): Promise<BlameLine[]> {
    const result = await this.executor.exec(
      ["blame", "--line-porcelain", revision, "--", file],
      { cwd: root, timeoutMs: this.timeoutMs }
    );
    return parseBlame(result.stdout);
  }
}

export { parseBlame };

function parseBlame(raw: string): BlameLine[] {
  const lines = raw.split(/\r?\n/);
  const output: BlameLine[] = [];
  let current: Partial<BlameLine> = {};

  for (const line of lines) {
    if (/^[0-9a-f]{40} /.test(line)) {
      const fields = line.split(" ");
      current = {
        commit: fields[0],
        line: Number(fields[2])
      };
      continue;
    }
    if (line.startsWith("author ")) current.author = line.slice(7);
    else if (line.startsWith("author-time ")) current.timestamp = Number(line.slice(12));
    else if (line.startsWith("\t")) {
      output.push({
        line: current.line ?? output.length + 1,
        commit: current.commit ?? "",
        author: current.author ?? "",
        timestamp: current.timestamp ?? 0,
        content: line.slice(1)
      });
      current = {};
    }
  }

  return output;
}
