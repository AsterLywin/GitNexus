export interface GitHubRemote {
  owner: string;
  repo: string;
}

/**
 * Parse a GitHub remote URL (https, ssh, git protocol; with or without
 * the .git suffix) into owner/repo. Returns undefined for non-GitHub or
 * unparsable URLs. Pure — unit-tested.
 */
export function parseGitHubRemote(url: string): GitHubRemote | undefined {
  const trimmed = url.trim();
  const patterns = [
    /^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/,
    /^ssh:\/\/(?:git@)?github\.com\/([^/]+)\/(.+?)(?:\.git)?$/,
    /^https?:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?\/?$/,
    /^git:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?$/
  ];
  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match) return { owner: match[1], repo: match[2] };
  }
  return undefined;
}

export function compareUrl(remote: GitHubRemote, baseBranch: string, headBranch: string): string {
  const base = encodeURIComponent(baseBranch);
  const head = encodeURIComponent(headBranch);
  return `https://github.com/${remote.owner}/${remote.repo}/compare/${base}...${head}?expand=1`;
}

export interface GitLabRemote {
  host: string;
  /** Full project path, e.g. "group/subgroup/project" (nested groups). */
  projectPath: string;
}

export interface BitbucketRemote {
  workspace: string;
  repo: string;
}

function splitHostPath(url: string): { host: string; path: string } | undefined {
  const trimmed = url.trim().replace(/\.git\/?$/, "");
  const scp = trimmed.match(/^git@([^:]+):(.+)$/);
  if (scp) return { host: scp[1], path: scp[2] };
  const full = trimmed.match(/^(?:https?|ssh|git):\/\/(?:[^@/]+@)?([^/]+)\/(.+)$/);
  if (full) return { host: full[1], path: full[2] };
  return undefined;
}

/**
 * Parse a GitLab remote (gitlab.com or a self-hosted host whose name
 * contains "gitlab", plus any hosts the caller declares). The project
 * path keeps nested groups. Pure.
 */
export function parseGitLabRemote(url: string, extraHosts: string[] = []): GitLabRemote | undefined {
  const parts = splitHostPath(url);
  if (!parts) return undefined;
  const isGitLab = parts.host === "gitlab.com"
    || parts.host.includes("gitlab")
    || extraHosts.includes(parts.host);
  if (!isGitLab || !parts.path.includes("/")) return undefined;
  return { host: parts.host, projectPath: parts.path };
}

/** Parse a Bitbucket Cloud remote. Pure. */
export function parseBitbucketRemote(url: string): BitbucketRemote | undefined {
  const parts = splitHostPath(url);
  if (!parts || parts.host !== "bitbucket.org") return undefined;
  const segments = parts.path.split("/");
  if (segments.length !== 2) return undefined;
  return { workspace: segments[0], repo: segments[1] };
}
