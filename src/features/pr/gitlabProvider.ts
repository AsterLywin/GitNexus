import { PullRequestProvider, PullRequestSummary } from "../../domain/pr";
import { GitLabRemote } from "./remoteInfo";

export interface GitLabProviderDeps {
  remote: GitLabRemote;
  /** Returns a GitLab personal access token (api scope), or undefined. */
  getToken: () => Promise<string | undefined>;
  fetchFn?: typeof fetch;
  apiBase?: string;
}

interface GitLabMr {
  id: number;
  iid: number;
  title: string;
  state: string;
  web_url: string;
  sha?: string;
  source_branch: string;
  target_branch: string;
  author?: { username?: string };
}

/** Map a GitLab merge request to the provider-neutral summary. Pure. */
export function mapGitLabMergeRequest(mr: GitLabMr): PullRequestSummary {
  return {
    id: String(mr.id),
    number: mr.iid,
    title: mr.title,
    state: mr.state === "merged" ? "merged" : mr.state === "opened" ? "open" : "closed",
    author: mr.author?.username ?? "unknown",
    headBranch: mr.source_branch,
    headSha: mr.sha ?? "",
    baseBranch: mr.target_branch,
    url: mr.web_url
  };
}

/**
 * GitLab adapter (Layer C): gitlab.com and self-hosted instances.
 * Tokens come from the caller's getToken (auth session or
 * SecretStorage); merge requests are read from the v4 API.
 */
export class GitLabPullRequestProvider implements PullRequestProvider {
  readonly id = "gitlab";
  readonly displayName = "GitLab";
  readonly repositorySlug: string;

  private readonly fetchFn: typeof fetch;
  private readonly apiBase: string;

  constructor(private readonly deps: GitLabProviderDeps) {
    this.repositorySlug = deps.remote.projectPath;
    this.fetchFn = deps.fetchFn ?? fetch;
    this.apiBase = deps.apiBase ?? `https://${deps.remote.host}/api/v4`;
  }

  private get projectId(): string {
    return encodeURIComponent(this.deps.remote.projectPath);
  }

  async listOpen(): Promise<PullRequestSummary[]> {
    const data = await this.request<GitLabMr[]>(
      `/projects/${this.projectId}/merge_requests?state=opened&per_page=50`
    );
    return data.map(mapGitLabMergeRequest);
  }

  async forBranch(branch: string): Promise<PullRequestSummary | undefined> {
    const data = await this.request<GitLabMr[]>(
      `/projects/${this.projectId}/merge_requests?state=opened&source_branch=${encodeURIComponent(branch)}`
    );
    return data[0] ? mapGitLabMergeRequest(data[0]) : undefined;
  }

  createUrl(baseBranch: string, headBranch: string): string {
    const params = new URLSearchParams({
      "merge_request[source_branch]": headBranch,
      "merge_request[target_branch]": baseBranch
    });
    return `https://${this.deps.remote.host}/${this.deps.remote.projectPath}/-/merge_requests/new?${params.toString()}`;
  }

  private async request<T>(path: string): Promise<T> {
    const token = await this.deps.getToken();
    if (!token) {
      throw new Error("GitNexus: no GitLab token. Run “GitNexus: Set GitLab Token” first.");
    }
    const response = await this.fetchFn(`${this.apiBase}${path}`, {
      headers: { "PRIVATE-TOKEN": token }
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`GitLab API ${response.status} for ${path}: ${body.slice(0, 200)}`);
    }
    return (await response.json()) as T;
  }
}
