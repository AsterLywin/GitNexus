import { CiStatus, IssueSummary, PullRequestProvider, PullRequestSummary, ReviewStatus } from "../../domain/pr";
import { GitLabRemote } from "./remoteInfo";

/** Map a GitLab pipeline status to the neutral CI status. Pure. */
export function mapGitLabPipelineStatus(status: string | undefined): CiStatus {
  switch (status) {
    case "success": return "success";
    case "failed": case "canceled": return "failure";
    case "running": case "pending": case "created": case "preparing":
    case "scheduled": case "manual": case "waiting_for_resource": return "pending";
    default: return "unknown";
  }
}

/** Map a GitLab approvals payload to the neutral review status. Pure. */
export function mapGitLabApproval(data: {
  approved?: boolean;
  approvals_required?: number;
  approved_by?: unknown[];
}): ReviewStatus {
  if (data.approved) return "approved";
  if ((data.approvals_required ?? 0) > 0 || (data.approved_by?.length ?? 0) > 0) return "pending";
  return "none";
}

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
  source_project_id?: number;
  target_project_id?: number;
  author?: { username?: string };
}

interface GitLabIssue {
  id: number;
  iid: number;
  title: string;
  state: string;
  web_url: string;
  labels?: string[];
  author?: { username?: string };
}

/** Map a GitLab issue to the neutral summary. Pure. */
export function mapGitLabIssue(issue: GitLabIssue): IssueSummary {
  return {
    id: String(issue.id),
    number: issue.iid,
    title: issue.title,
    state: issue.state === "closed" ? "closed" : "open",
    author: issue.author?.username ?? "unknown",
    url: issue.web_url,
    labels: issue.labels ?? []
  };
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
    url: mr.web_url,
    fork: mr.source_project_id !== undefined
      && mr.target_project_id !== undefined
      && mr.source_project_id !== mr.target_project_id
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
    const mr = data[0];
    if (!mr) return undefined;
    const summary = mapGitLabMergeRequest(mr);
    const [ciStatus, reviewStatus] = await Promise.all([
      this.pipelineStatus(mr.sha).catch(() => "unknown" as CiStatus),
      this.approvalStatus(mr.iid).catch(() => "none" as ReviewStatus)
    ]);
    return { ...summary, ciStatus, reviewStatus };
  }

  private async pipelineStatus(sha?: string): Promise<CiStatus> {
    if (!sha) return "unknown";
    const data = await this.request<Array<{ status: string }>>(
      `/projects/${this.projectId}/pipelines?sha=${encodeURIComponent(sha)}&per_page=1`
    );
    return mapGitLabPipelineStatus(data[0]?.status);
  }

  private async approvalStatus(iid: number): Promise<ReviewStatus> {
    const data = await this.request<{
      approved?: boolean;
      approvals_required?: number;
      approved_by?: unknown[];
    }>(`/projects/${this.projectId}/merge_requests/${iid}/approvals`);
    return mapGitLabApproval(data);
  }

  async listIssues(): Promise<IssueSummary[]> {
    const data = await this.request<GitLabIssue[]>(
      `/projects/${this.projectId}/issues?state=opened&per_page=50`
    );
    return data.map(mapGitLabIssue);
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
