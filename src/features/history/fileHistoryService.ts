import { GitProcessExecutor } from "../../git/processExecutor";
import { CommitSummary } from "../../domain/git";
import { parseLog } from "../../git/parsers/logParser";

export class FileHistoryService {
  constructor(
    private readonly executor: GitProcessExecutor,
    private readonly timeoutMs = 30000
  ) {}

  async history(root: string, file: string, limit = 100): Promise<CommitSummary[]> {
    const format = `%H${"\x1f"}%P${"\x1f"}%an${"\x1f"}%ae${"\x1f"}%at${"\x1f"}%cn${"\x1f"}%ce${"\x1f"}%ct${"\x1f"}%s${"\x1f"}%b${"\x1e"}`;
    const result = await this.executor.exec(
      ["log", `-${limit}`, "--follow", `--format=${format}`, "--", file],
      { cwd: root, timeoutMs: this.timeoutMs }
    );
    return parseLog(result.stdout);
  }
}
