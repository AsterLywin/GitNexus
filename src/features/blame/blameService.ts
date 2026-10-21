import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GitProcessExecutor } from "../../git/processExecutor";

let bufferCounter = 0;

export interface BlameLine {
  /** 1-based line number in the blamed revision. */
  line: number;
  /** 1-based line number in the commit that introduced the line. */
  originalLine: number;
  commit: string;
  author: string;
  authorEmail: string;
  /** Author timestamp, seconds since epoch. */
  timestamp: number;
  summary: string;
  content: string;
  /** True for lines not yet in any commit (zero hash from Git). */
  uncommitted: boolean;
}

export interface CommitInfo {
  hash: string;
  author: string;
  authorEmail: string;
  /** Author timestamp, seconds since epoch. */
  timestamp: number;
  subject: string;
  body: string;
}

const UNCOMMITTED_HASH = "0000000000000000000000000000000000000000";

/**
 * Blame + commit metadata reads (GIT_ENGINE_SPEC §14). Parsing targets
 * `git blame --line-porcelain`, whose per-line header blocks repeat every
 * field — robust against filenames/summaries with arbitrary characters.
 */
export class BlameService {
  private readonly commitInfoCache = new Map<string, CommitInfo>();

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

  /**
   * Blame as if the file's contents were `content` (an editor buffer,
   * possibly unsaved) via `git blame --contents`. Lines that differ from
   * HEAD come back with the zero hash (uncommitted), shifted lines keep
   * their true attribution — so annotations stay correct while typing.
   */
  async blameBuffer(root: string, file: string, content: string): Promise<BlameLine[]> {
    const scratch = join(tmpdir(), `gitnexus-blame-${process.pid}-${bufferCounter++}.tmp`);
    await writeFile(scratch, content, "utf8");
    try {
      const result = await this.executor.exec(
        ["blame", "--line-porcelain", "--contents", scratch, "--", file],
        { cwd: root, timeoutMs: this.timeoutMs }
      );
      return parseBlame(result.stdout);
    } finally {
      await rm(scratch, { force: true }).catch(() => undefined);
    }
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

  /** Full metadata for one commit (hover cards, details). Cached per root+hash. */
  async commitInfo(root: string, hash: string): Promise<CommitInfo | undefined> {
    const key = `${root}\n${hash}`;
    const cached = this.commitInfoCache.get(key);
    if (cached) return cached;
    const result = await this.executor.exec(
      ["log", "-1", "--format=%an%x00%ae%x00%at%x00%s%x00%b%x00", hash],
      { cwd: root, timeoutMs: this.timeoutMs }
    ).catch(() => undefined);
    if (!result || result.exitCode !== 0) return undefined;
    const [author = "", authorEmail = "", at = "0", subject = "", body = ""] = result.stdout.split("\x00");
    const info: CommitInfo = {
      hash,
      author,
      authorEmail,
      timestamp: Number(at) || 0,
      subject,
      body: body.replace(/\n+$/, "")
    };
    this.commitInfoCache.set(key, info);
    return info;
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
        originalLine: Number(fields[1]),
        line: Number(fields[2]),
        uncommitted: fields[0] === UNCOMMITTED_HASH
      };
      continue;
    }
    if (line.startsWith("author ")) current.author = line.slice(7);
    else if (line.startsWith("author-mail ")) current.authorEmail = line.slice(12).replace(/^<|>$/g, "");
    else if (line.startsWith("author-time ")) current.timestamp = Number(line.slice(12));
    else if (line.startsWith("summary ")) current.summary = line.slice(8);
    else if (line.startsWith("\t")) {
      output.push({
        line: current.line ?? output.length + 1,
        originalLine: current.originalLine ?? current.line ?? output.length + 1,
        commit: current.commit ?? "",
        author: current.author ?? "",
        authorEmail: current.authorEmail ?? "",
        timestamp: current.timestamp ?? 0,
        summary: current.summary ?? "",
        content: line.slice(1),
        uncommitted: current.uncommitted ?? false
      });
      current = {};
    }
  }

  return output;
}
