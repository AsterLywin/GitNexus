import { GitObjectId, CommitSummary, RepositoryIdentity, RepositoryStatus } from "../domain/git";
import { GitProcessExecutor } from "./processExecutor";
import { parsePorcelainV2Status } from "./parsers/statusParser";
import { parseLog } from "./parsers/logParser";

export class GitService {
  constructor(
    private readonly executor: GitProcessExecutor,
    private readonly timeoutMs = 30000
  ) {}

  async discoverRepository(path: string): Promise<RepositoryIdentity> {
    const result = await this.executor.exec(
      ["rev-parse", "--show-toplevel", "--git-dir", "--git-common-dir", "--is-bare-repository"],
      { cwd: path, timeoutMs: this.timeoutMs }
    );
    const lines = result.stdout.trim().split(/\r?\n/);
    return {
      rootUri: lines[0],
      gitDir: lines[1],
      commonDir: lines[2],
      isBare: lines[3] === "true"
    };
  }

  async status(root: string): Promise<RepositoryStatus> {
    const result = await this.executor.exec(
      ["status", "--porcelain=v2", "-z", "--branch"],
      { cwd: root, timeoutMs: this.timeoutMs }
    );
    return parsePorcelainV2Status(result.stdout);
  }

  async head(root: string): Promise<{ ref?: string; commit?: GitObjectId; detached: boolean }> {
    const result = await this.executor.exec(
      ["symbolic-ref", "--quiet", "--short", "HEAD"],
      { cwd: root, timeoutMs: this.timeoutMs }
    ).catch(() => undefined);

    const commit = await this.executor.exec(
      ["rev-parse", "HEAD"],
      { cwd: root, timeoutMs: this.timeoutMs }
    ).then(x => x.stdout.trim()).catch(() => undefined);

    return {
      ref: result?.stdout.trim() || undefined,
      commit,
      detached: !result
    };
  }

  async log(root: string, limit = 200): Promise<CommitSummary[]> {
    const format = `%H${"\x1f"}%P${"\x1f"}%an${"\x1f"}%ae${"\x1f"}%at${"\x1f"}%cn${"\x1f"}%ce${"\x1f"}%ct${"\x1f"}%s${"\x1f"}%b${"\x1e"}`;
    const result = await this.executor.exec(
      ["log", `-${limit}`, `--format=${format}`],
      { cwd: root, timeoutMs: this.timeoutMs }
    );
    return parseLog(result.stdout);
  }
}
