export interface GitHubRemote {
  owner: string;
  repo: string;
  /** Enterprise host; undefined for github.com. */
  host?: string;
}

/**
 * Parse a GitHub remote URL (https, ssh, git protocol; with or without
 * the .git suffix) into owner/repo. Enterprise hosts are recognized
 * when declared via `enterpriseHosts`. Returns undefined for
 * non-GitHub or unparsable URLs. Pure — unit-tested.
 */
export function parseGitHubRemote(url: string, enterpriseHosts: string[] = []): GitHubRemote | undefined {
  const parts = splitHostPath(url);
  if (!parts) return undefined;
  const isGitHub = parts.host === "github.com" || enterpriseHosts.includes(parts.host);
  if (!isGitHub) return undefined;
  const segments = parts.path.split("/");
  if (segments.length !== 2 || !segments[0] || !segments[1]) return undefined;
  const remote: GitHubRemote = { owner: segments[0], repo: segments[1] };
  if (parts.host !== "github.com") remote.host = parts.host;
  return remote;
}

export function compareUrl(remote: GitHubRemote, baseBranch: string, headBranch: string): string {
  const base = encodeURIComponent(baseBranch);
  const head = encodeURIComponent(headBranch);
  return `https://${remote.host ?? "github.com"}/${remote.owner}/${remote.repo}/compare/${base}...${head}?expand=1`;
}

/** Web URL of a commit on whichever host the remote points at. Pure. */
export function commitWebUrl(remoteUrl: string, sha: string, githubEnterpriseHosts: string[] = []): string | undefined {
  const github = parseGitHubRemote(remoteUrl, githubEnterpriseHosts);
  if (github) return `https://${github.host ?? "github.com"}/${github.owner}/${github.repo}/commit/${sha}`;
  const gitlab = parseGitLabRemote(remoteUrl);
  if (gitlab) return `https://${gitlab.host}/${gitlab.projectPath}/-/commit/${sha}`;
  const bitbucket = parseBitbucketRemote(remoteUrl);
  if (bitbucket) return `https://bitbucket.org/${bitbucket.workspace}/${bitbucket.repo}/commits/${sha}`;
  return undefined;
}

/** Web URL of the issue list item `#<number>` on the remote's host. Pure. */
export function issueWebUrlTemplate(remoteUrl: string, githubEnterpriseHosts: string[] = []): string | undefined {
  const github = parseGitHubRemote(remoteUrl, githubEnterpriseHosts);
  if (github) return `https://${github.host ?? "github.com"}/${github.owner}/${github.repo}/issues/<num>`;
  const gitlab = parseGitLabRemote(remoteUrl);
  if (gitlab) return `https://${gitlab.host}/${gitlab.projectPath}/-/issues/<num>`;
  const bitbucket = parseBitbucketRemote(remoteUrl);
  if (bitbucket) return `https://bitbucket.org/${bitbucket.workspace}/${bitbucket.repo}/issues/<num>`;
  return undefined;
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
  const trimmed = url.trim().replace(/\.git\/?$/, "").replace(/\/$/, "");
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
