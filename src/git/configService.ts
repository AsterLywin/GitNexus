import { GitProcessExecutor } from "./processExecutor";

export type GitConfigScope = "local" | "worktree" | "global" | "system";

export interface GitConfigEntry {
  key: string;
  value: string;
  scope?: GitConfigScope;
}

/**
 * Keys whose values must never be displayed or logged (GIT_ENGINE_SPEC §20):
 * credentials, tokens, passwords, and URLs that may embed them.
 */
export function isSensitiveConfigKey(key: string): boolean {
  const lower = key.toLowerCase();
  return /(credential|password|passwd|token|secret|api[-_.]?key|authorization)/.test(lower);
}

export function redactConfigValue(key: string, value: string): string {
  if (isSensitiveConfigKey(key)) return "***redacted***";
  // Redact userinfo embedded in remote URLs even for ordinary keys.
  return value.replace(/(https?:\/\/)[^/@\s]+@/gi, "$1***@");
}

export function parseConfigList(raw: string): GitConfigEntry[] {
  return raw.split(/\r?\n/).filter(Boolean).map(line => {
    const eq = line.indexOf("=");
    if (eq < 0) return { key: line, value: "" };
    return { key: line.slice(0, eq), value: line.slice(eq + 1) };
  });
}

/** Typed Git config access (GIT_ENGINE_SPEC §20). Reads classify values via
 * redactConfigValue before they reach any UI or log surface. */
export class ConfigService {
  constructor(
    private readonly executor: GitProcessExecutor,
    private readonly timeoutMs = 30000
  ) {}

  async get(root: string, key: string, scope?: GitConfigScope): Promise<string | undefined> {
    const args = ["config", ...(scope ? [`--${scope}`] : []), "--get", key];
    const result = await this.executor.exec(args, { cwd: root, timeoutMs: this.timeoutMs })
      .catch(() => undefined);
    return result?.stdout.replace(/\r?\n$/, "") || undefined;
  }

  async list(root: string, scope?: GitConfigScope): Promise<GitConfigEntry[]> {
    const args = ["config", ...(scope ? [`--${scope}`] : []), "--list"];
    const result = await this.executor.exec(args, { cwd: root, timeoutMs: this.timeoutMs });
    return parseConfigList(result.stdout).map(entry => ({ ...entry, scope }));
  }

  /** Listed entries with sensitive values redacted — the only form UI should render. */
  async listRedacted(root: string, scope?: GitConfigScope): Promise<GitConfigEntry[]> {
    const entries = await this.list(root, scope);
    return entries.map(entry => ({ ...entry, value: redactConfigValue(entry.key, entry.value) }));
  }

  async set(root: string, key: string, value: string, scope: GitConfigScope = "local"): Promise<void> {
    await this.executor.exec(["config", `--${scope}`, key, value], { cwd: root, timeoutMs: this.timeoutMs });
  }

  async unset(root: string, key: string, scope: GitConfigScope = "local"): Promise<void> {
    await this.executor.exec(["config", `--${scope}`, "--unset", key], { cwd: root, timeoutMs: this.timeoutMs });
  }
}
