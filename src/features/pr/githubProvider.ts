import {
  CiStatus,
  PullRequestProvider,
  PullRequestSummary,
  ReviewStatus
} from "../../domain/pr";
import { GitHubRemote, compareUrl } from "./remoteInfo";

export interface GitHubProviderDeps {
  remote: GitHubRemote;
  /** Returns a GitHub access token, or undefined when not signed in. */
  getToken: () => Promise<string | undefined>;
  fetchFn?: typeof fetch;
  apiBase?: string;
}

interface GitHubPr {
  id: number;
  number: number;
  title: string;
  state: string;
  merged_at?: string | null;
  html_url: string;
  user?: { login?: string };
  head: { ref: string; sha: string };
  base: { ref: string };
}

/** First PullRequestProvider adapter: GitHub REST (Layer C). */
export class GitHubPullRequestProvider implements PullRequestProvider {
  readonly id = "github";
  readonly displayName = "GitHub";
  readonly repositorySlug: string;

  private readonly fetchFn: typeof fetch;
  private readonly apiBase: string;

  constructor(private readonly deps: GitHubProviderDeps) {
    this.repositorySlug = `${deps.remote.owner}/${deps.remote.repo}`;
    this.fetchFn = deps.fetchFn ?? fetch;
    // GitHub Enterprise serves its REST API under https://<host>/api/v3.
    this.apiBase = deps.apiBase
      ?? (deps.remote.host ? `https://${deps.remote.host}/api/v3` : "https://api.github.com");
  }

  async listOpen(): Promise<PullRequestSummary[]> {
    const data = await this.request<GitHubPr[]>(
      `/repos/${this.slug}/pulls?state=open&per_page=50`
    );
    return data.map(pr => this.map(pr));
  }

  async forBranch(branch: string): Promise<PullRequestSummary | undefined> {
    const data = await this.request<GitHubPr[]>(
      `/repos/${this.slug}/pulls?state=open&head=${encodeURIComponent(`${this.deps.remote.owner}:${branch}`)}`
    );
    const pr = data[0];
    if (!pr) return undefined;
    const summary = this.map(pr);
    const [ciStatus, reviewStatus] = await Promise.all([
      this.checkStatus(pr.head.sha).catch(() => "unknown" as CiStatus),
      this.reviewStatus(pr.number).catch(() => "none" as ReviewStatus)
    ]);
    return { ...summary, ciStatus, reviewStatus };
  }

  createUrl(baseBranch: string, headBranch: string): string {
    return compareUrl(this.deps.remote, baseBranch, headBranch);
  }

  private get slug(): string {
    return `${this.deps.remote.owner}/${this.deps.remote.repo}`;
  }

  private map(pr: GitHubPr): PullRequestSummary {
    return {
      id: String(pr.id),
      number: pr.number,
      title: pr.title,
      state: pr.merged_at ? "merged" : pr.state === "closed" ? "closed" : "open",
      author: pr.user?.login ?? "unknown",
      headBranch: pr.head.ref,
      headSha: pr.head.sha,
      baseBranch: pr.base.ref,
      url: pr.html_url
    };
  }

  private async checkStatus(sha: string): Promise<CiStatus> {
    const data = await this.request<{ check_runs: Array<{ status: string; conclusion: string | null }> }>(
      `/repos/${this.slug}/commits/${sha}/check-runs`
    );
    const runs = data.check_runs ?? [];
    if (!runs.length) return "unknown";
    if (runs.some(r => r.conclusion === "failure" || r.conclusion === "timed_out")) return "failure";
    if (runs.some(r => r.status !== "completed")) return "pending";
    return "success";
  }

  private async reviewStatus(prNumber: number): Promise<ReviewStatus> {
    const data = await this.request<Array<{ user?: { login?: string }; state: string }>>(
      `/repos/${this.slug}/pulls/${prNumber}/reviews`
    );
    if (!data.length) return "none";
    if (data.some(r => r.state === "CHANGES_REQUESTED")) return "changes-requested";
    if (data.some(r => r.state === "APPROVED")) return "approved";
    return "pending";
  }

  private async request<T>(path: string): Promise<T> {
    const token = await this.deps.getToken();
    const response = await this.fetchFn(`${this.apiBase}${path}`, {
      headers: {
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        ...(token ? { authorization: `Bearer ${token}` } : {})
      }
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`GitHub API ${response.status} for ${path}: ${body.slice(0, 200)}`);
    }
    return (await response.json()) as T;
  }
}
