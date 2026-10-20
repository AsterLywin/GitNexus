import { GitProcessExecutor } from "./processExecutor";

export interface GitRemote {
  name: string;
  fetchUrl?: string;
  pushUrl?: string;
}

export function parseRemoteList(raw: string): GitRemote[] {
  const byName = new Map<string, GitRemote>();
  for (const line of raw.split(/\r?\n/).filter(Boolean)) {
    const match = line.match(/^(\S+)\t(.*) \((fetch|push)\)$/);
    if (!match) continue;
    const [, name, url, kind] = match;
    const remote = byName.get(name) ?? { name };
    if (kind === "fetch") remote.fetchUrl = url;
    else remote.pushUrl = url;
    byName.set(name, remote);
  }
  return [...byName.values()];
}

export interface PushOptions {
  remote?: string;
  branch?: string;
  setUpstream?: boolean;
  forceWithLease?: boolean;
  tags?: boolean;
}

export interface PullOptions {
  remote?: string;
  branch?: string;
  rebase?: boolean;
  ffOnly?: boolean;
}

/** Typed remote operations (GIT_ENGINE_SPEC §9, §19). Credentials never enter
 * this layer or its logs; authentication is Git's / VS Code's concern. */
export class RemoteService {
  constructor(
    private readonly executor: GitProcessExecutor,
    private readonly timeoutMs = 120000
  ) {}

  async list(root: string): Promise<GitRemote[]> {
    const result = await this.executor.exec(["remote", "-v"], { cwd: root, timeoutMs: this.timeoutMs });
    return parseRemoteList(result.stdout);
  }

  async add(root: string, name: string, url: string): Promise<void> {
    await this.executor.exec(["remote", "add", name, url], { cwd: root, timeoutMs: this.timeoutMs });
  }

  async remove(root: string, name: string): Promise<void> {
    await this.executor.exec(["remote", "remove", name], { cwd: root, timeoutMs: this.timeoutMs });
  }

  async setUrl(root: string, name: string, url: string, push = false): Promise<void> {
    await this.executor.exec(
      ["remote", "set-url", ...(push ? ["--push"] : []), name, url],
      { cwd: root, timeoutMs: this.timeoutMs }
    );
  }

  async fetch(root: string, remote?: string, options: { prune?: boolean; tags?: boolean } = {}): Promise<void> {
    const args = ["fetch", ...(options.prune ? ["--prune"] : []), ...(options.tags ? ["--tags"] : [])];
    if (remote) args.push(remote);
    await this.executor.exec(args, { cwd: root, timeoutMs: this.timeoutMs });
  }

  async prune(root: string, remote: string): Promise<void> {
    await this.executor.exec(["remote", "prune", remote], { cwd: root, timeoutMs: this.timeoutMs });
  }

  async pull(root: string, options: PullOptions = {}): Promise<void> {
    const args = ["pull"];
    if (options.rebase) args.push("--rebase");
    if (options.ffOnly) args.push("--ff-only");
    if (options.remote) args.push(options.remote);
    if (options.branch) args.push(options.branch);
    await this.executor.exec(args, { cwd: root, timeoutMs: this.timeoutMs });
  }

  async push(root: string, options: PushOptions = {}): Promise<void> {
    const args = ["push"];
    if (options.setUpstream) args.push("--set-upstream");
    if (options.forceWithLease) args.push("--force-with-lease");
    if (options.tags) args.push("--tags");
    args.push(options.remote ?? "origin");
    if (options.branch) args.push(options.branch);
    await this.executor.exec(args, { cwd: root, timeoutMs: this.timeoutMs });
  }
}
