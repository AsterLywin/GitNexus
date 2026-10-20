import { GitProcessExecutor } from "../../git/processExecutor";
import { CommitSummary } from "../../domain/git";
import { parseLog } from "../../git/parsers/logParser";

export interface CommitSearchQuery {
  text?: string;
  author?: string;
  file?: string;
  after?: string;
  before?: string;
  limit?: number;
  allRefs?: boolean;
}

export class CommitSearchService {
  constructor(
    private readonly executor: GitProcessExecutor,
    private readonly timeoutMs = 30000
  ) {}

  async search(root: string, query: CommitSearchQuery): Promise<CommitSummary[]> {
    const format = `%H${"\x1f"}%P${"\x1f"}%an${"\x1f"}%ae${"\x1f"}%at${"\x1f"}%cn${"\x1f"}%ce${"\x1f"}%ct${"\x1f"}%s${"\x1f"}%b${"\x1e"}`;
    const args = ["log", `-${query.limit ?? 100}`, `--format=${format}`];

    if (query.allRefs) args.push("--all");
    if (query.text) args.push(`--grep=${query.text}`, "--regexp-ignore-case");
    if (query.author) args.push(`--author=${query.author}`);
    if (query.after) args.push(`--after=${query.after}`);
    if (query.before) args.push(`--before=${query.before}`);
    if (query.file) args.push("--", query.file);

    const result = await this.executor.exec(args, {
      cwd: root,
      timeoutMs: this.timeoutMs
    });
    return parseLog(result.stdout);
  }

  /**
   * Pickaxe search (GIT_ENGINE_SPEC §15): commits where the number of
   * occurrences of `text` changed (-S, string mode) or whose diff text
   * matches `text` (-G, regex mode).
   */
  async pickaxe(
    root: string,
    text: string,
    mode: "string" | "regex" = "string",
    options: { file?: string; limit?: number; allRefs?: boolean } = {}
  ): Promise<CommitSummary[]> {
    const format = `%H${"\x1f"}%P${"\x1f"}%an${"\x1f"}%ae${"\x1f"}%at${"\x1f"}%cn${"\x1f"}%ce${"\x1f"}%ct${"\x1f"}%s${"\x1f"}%b${"\x1e"}`;
    const args = ["log", `-${options.limit ?? 100}`, `--format=${format}`];
    if (options.allRefs) args.push("--all");
    args.push(mode === "string" ? `-S${text}` : `-G${text}`);
    if (options.file) args.push("--", options.file);

    const result = await this.executor.exec(args, {
      cwd: root,
      timeoutMs: this.timeoutMs
    });
    return parseLog(result.stdout);
  }
}
