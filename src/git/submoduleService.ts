import { GitProcessExecutor } from "./processExecutor";

export type SubmoduleStatusKind = "clean" | "uninitialized" | "modified" | "conflicted";

export interface SubmoduleEntry {
  path: string;
  commit: string;
  status: SubmoduleStatusKind;
  describe?: string;
}

const STATUS_BY_PREFIX: Record<string, SubmoduleStatusKind> = {
  " ": "clean",
  "-": "uninitialized",
  "+": "modified",
  "U": "conflicted"
};

/** Parse `git submodule status` output: "<prefix><sha> <path> (<describe>)". */
export function parseSubmoduleStatus(raw: string): SubmoduleEntry[] {
  const parsed: Array<SubmoduleEntry | undefined> = raw.split(/\r?\n/).filter(Boolean).map(line => {
    const match = line.match(/^([-+U ])(\S+) (\S+)(?: \((.*)\))?$/);
    if (!match) return undefined;
    const [, prefix, commit, path, describe] = match;
    return {
      path,
      commit,
      status: STATUS_BY_PREFIX[prefix] ?? "clean",
      describe: describe || undefined
    };
  });
  return parsed.filter((x): x is SubmoduleEntry => Boolean(x));
}

/** Submodule operations (GIT_ENGINE_SPEC §9, State Model §34). Submodules are
 * separate repositories; this service reports them without merging their
 * state into the parent's model. */
export class SubmoduleService {
  constructor(
    private readonly executor: GitProcessExecutor,
    private readonly timeoutMs = 120000
  ) {}

  async status(root: string): Promise<SubmoduleEntry[]> {
    const result = await this.executor.exec(["submodule", "status"], { cwd: root, timeoutMs: this.timeoutMs });
    return parseSubmoduleStatus(result.stdout);
  }

  async init(root: string, path?: string): Promise<void> {
    await this.executor.exec(["submodule", "init", ...(path ? [path] : [])], { cwd: root, timeoutMs: this.timeoutMs });
  }

  async update(root: string, options: { init?: boolean; recursive?: boolean; path?: string } = {}): Promise<void> {
    const args = ["submodule", "update"];
    if (options.init) args.push("--init");
    if (options.recursive) args.push("--recursive");
    if (options.path) args.push(options.path);
    await this.executor.exec(args, { cwd: root, timeoutMs: this.timeoutMs });
  }

  async sync(root: string, recursive = false): Promise<void> {
    await this.executor.exec(
      ["submodule", "sync", ...(recursive ? ["--recursive"] : [])],
      { cwd: root, timeoutMs: this.timeoutMs }
    );
  }
}
