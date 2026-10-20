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
