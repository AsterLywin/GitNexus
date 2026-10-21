import { GitObjectId, CommitSummary, RepositoryIdentity, RepositoryStatus } from "../domain/git";
import { GitBackend, streamCommits } from "./backend";
import { MetadataCache } from "./cache";
import { GitError } from "./errors";
import { GitProcessExecutor } from "./processExecutor";
import { parsePorcelainV2Status } from "./parsers/statusParser";
import { parseLog } from "./parsers/logParser";
import { parseShortlog, ContributorSummary } from "./parsers/shortlogParser";
import {
  GitCapabilities,
  GitVersion,
  detectCapabilities,
  isSupportedGitVersion,
  parseGitVersion
} from "./version";

export interface LogOptions {
  allRefs?: boolean;
  firstParent?: boolean;
  /** Limit history to a path (enables follow when combined with `follow`). */
  path?: string;
  follow?: boolean;
  author?: string;
  grep?: string;
  since?: string;
  until?: string;
  /** Revision range expression, e.g. "main..HEAD". */
  range?: string;
}

export const LOG_FORMAT = `%H${"\x1f"}%P${"\x1f"}%an${"\x1f"}%ae${"\x1f"}%at${"\x1f"}%cn${"\x1f"}%ce${"\x1f"}%ct${"\x1f"}%s${"\x1f"}%b${"\x1e"}`;

export function buildLogArgs(limit: number, options: LogOptions = {}): string[] {
  const args = ["log", `-${limit}`, `--format=${LOG_FORMAT}`];
  if (options.allRefs) args.push("--all");
  if (options.firstParent) args.push("--first-parent");
  if (options.follow) args.push("--follow");
  if (options.author) args.push(`--author=${options.author}`);
  if (options.grep) args.push(`--grep=${options.grep}`);
  if (options.since) args.push(`--since=${options.since}`);
  if (options.until) args.push(`--until=${options.until}`);
  if (options.range) args.push(options.range);
  if (options.path) args.push("--", options.path);
  return args;
}

export class GitService {
  private readonly versionCache = new MetadataCache<GitVersion>(5 * 60_000);
  private readonly capabilitiesCache = new MetadataCache<GitCapabilities>(5 * 60_000);

  constructor(
    private readonly executor: GitProcessExecutor,
    private readonly timeoutMs = 30000,
    private readonly backend?: GitBackend
  ) {}

  /** Installed Git version (GIT_ENGINE_SPEC §8), cached — it cannot change per repo. */
  async getVersion(cwd: string): Promise<GitVersion> {
    const cached = this.versionCache.get("version");
    if (cached) return cached;
    const result = await this.executor.exec(["--version"], { cwd, timeoutMs: this.timeoutMs });
    const version = parseGitVersion(result.stdout);
    if (!version) {
      throw new GitError(`Could not parse Git version from: ${result.stdout.trim()}`, {
        code: "UNKNOWN",
        operation: "--version",
        repo: cwd
      });
    }
    this.versionCache.set("version", version);
    return version;
  }

  /** Detected capabilities; throws UNSUPPORTED_GIT_VERSION below the supported floor. */
  async capabilities(cwd: string): Promise<GitCapabilities> {
    const cached = this.capabilitiesCache.get("capabilities");
    if (cached) return cached;
    const version = await this.getVersion(cwd);
    if (!isSupportedGitVersion(version)) {
      throw new GitError(
        `Unsupported Git version ${version.major}.${version.minor}.${version.patch}; GitNexus requires Git >= 2.11 (porcelain v2).`,
        { code: "UNSUPPORTED_GIT_VERSION", operation: "--version", repo: cwd }
      );
    }
    const capabilities = detectCapabilities(version);
    this.capabilitiesCache.set("capabilities", capabilities);
    return capabilities;
  }

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

  async log(root: string, limit = 200, options: LogOptions = {}): Promise<CommitSummary[]> {
    const result = await this.executor.exec(
      buildLogArgs(limit, options),
      { cwd: root, timeoutMs: this.timeoutMs }
    ).catch((error: unknown) => {
      // Empty repository (unborn HEAD): history is legitimately empty,
      // not an error (GIT_ENGINE_SPEC §27 fixture class).
      if (error instanceof GitError && /does not have any commits|bad default revision|ambiguous argument 'HEAD'/i.test(error.stderr ?? error.message)) {
        return undefined;
      }
      throw error;
    });
    return result ? parseLog(result.stdout) : [];
  }

  /** Author ranking for the Contributors view (`git shortlog -sne`). */
  async contributors(root: string): Promise<ContributorSummary[]> {
    const result = await this.executor.exec(
      ["shortlog", "-sne", "--no-merges", "HEAD"],
      { cwd: root, timeoutMs: this.timeoutMs }
    ).catch(() => undefined);
    return result ? parseShortlog(result.stdout) : [];
  }

  /**
   * Streaming history (GIT_ENGINE_SPEC §21): yields commits as Git produces
   * them; the consumer can stop early and the process is terminated.
   * Requires a GitBackend; without one this falls back to a buffered log.
   */
  async *logStream(
    root: string,
    limit = 500,
    options: LogOptions = {},
    signal?: AbortSignal
  ): AsyncIterable<CommitSummary> {
    if (!this.backend) {
      yield* await this.log(root, limit, options);
      return;
    }
    yield* streamCommits(this.backend, {
      args: buildLogArgs(limit, options),
      cwd: root,
      timeoutMs: this.timeoutMs,
      signal
    });
  }
}
