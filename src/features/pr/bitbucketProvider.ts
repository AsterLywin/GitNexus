import { CiStatus, PullRequestProvider, PullRequestSummary, ReviewStatus } from "../../domain/pr";
import { BitbucketRemote } from "./remoteInfo";

/** Map Bitbucket build statuses for a commit to the neutral CI status. Pure. */
export function mapBitbucketStatuses(values: Array<{ state: string }>): CiStatus {
  if (values.length === 0) return "unknown";
  if (values.some(v => v.state === "FAILED")) return "failure";
  if (values.some(v => v.state === "INPROGRESS" || v.state === "STOPPED")) return "pending";
  return "success";
}

/** Map a Bitbucket PR detail payload to the neutral review status. Pure. */
export function mapBitbucketReview(detail: {
  participants?: Array<{ approved?: boolean }>;
  reviewers?: unknown[];
}): ReviewStatus {
  if (detail.participants?.some(p => p.approved)) return "approved";
  if ((detail.reviewers?.length ?? 0) > 0 || (detail.participants?.length ?? 0) > 0) return "pending";
  return "none";
}

export interface BitbucketProviderDeps {
  remote: BitbucketRemote;
  /** Returns the Authorization header (Basic app-password auth), or undefined. */
  getAuthHeader: () => Promise<string | undefined>;
  fetchFn?: typeof fetch;
  apiBase?: string;
}

interface BitbucketPr {
  id: number;
  title: string;
  state: string;
  author?: { display_name?: string; nickname?: string };
  source: { branch: { name: string }; commit?: { hash?: string } };
  destination: { branch: { name: string } };
  links: { html: { href: string } };
}

/** Map a Bitbucket Cloud pull request to the neutral summary. Pure. */
export function mapBitbucketPullRequest(pr: BitbucketPr): PullRequestSummary {
  return {
    id: String(pr.id),
    number: pr.id,
    title: pr.title,
    state: pr.state === "OPEN" ? "open" : pr.state === "MERGED" ? "merged" : "closed",
    author: pr.author?.display_name ?? pr.author?.nickname ?? "unknown",
    headBranch: pr.source.branch.name,
    headSha: pr.source.commit?.hash ?? "",
    baseBranch: pr.destination.branch.name,
    url: pr.links.html.href
  };
}

/**
 * Bitbucket Cloud adapter (Layer C). Auth is Basic with a username +
 * app password, supplied by the caller's getAuthHeader (SecretStorage).
 */
export class BitbucketPullRequestProvider implements PullRequestProvider {
  readonly id = "bitbucket";
  readonly displayName = "Bitbucket";
  readonly repositorySlug: string;

  private readonly fetchFn: typeof fetch;
  private readonly apiBase: string;

  constructor(private readonly deps: BitbucketProviderDeps) {
    this.repositorySlug = `${deps.remote.workspace}/${deps.remote.repo}`;
    this.fetchFn = deps.fetchFn ?? fetch;
    this.apiBase = deps.apiBase ?? "https://api.bitbucket.org/2.0";
  }

  private get repoPath(): string {
    return `/repositories/${this.deps.remote.workspace}/${this.deps.remote.repo}`;
  }

  async listOpen(): Promise<PullRequestSummary[]> {
    const data = await this.request<{ values: BitbucketPr[] }>(
      `${this.repoPath}/pullrequests?state=OPEN&pagelen=50`
    );
    return (data.values ?? []).map(mapBitbucketPullRequest);
  }

  async forBranch(branch: string): Promise<PullRequestSummary | undefined> {
    const open = await this.listOpen();
    const found = open.find(pr => pr.headBranch === branch);
    if (!found) return undefined;
    const [ciStatus, reviewStatus] = await Promise.all([
      this.commitStatus(found.headSha).catch(() => "unknown" as CiStatus),
      this.reviewStatus(found.number).catch(() => "none" as ReviewStatus)
    ]);
    return { ...found, ciStatus, reviewStatus };
  }

  private async commitStatus(sha: string): Promise<CiStatus> {
    if (!sha) return "unknown";
    const data = await this.request<{ values: Array<{ state: string }> }>(
      `${this.repoPath}/commit/${encodeURIComponent(sha)}/statuses?pagelen=50`
    );
    return mapBitbucketStatuses(data.values ?? []);
  }

  private async reviewStatus(id: number): Promise<ReviewStatus> {
    const data = await this.request<{
      participants?: Array<{ approved?: boolean }>;
      reviewers?: unknown[];
    }>(`${this.repoPath}/pullrequests/${id}`);
    return mapBitbucketReview(data);
  }

  createUrl(baseBranch: string, headBranch: string): string {
    const params = new URLSearchParams({ source: headBranch, dest: baseBranch });
    return `https://bitbucket.org/${this.repositorySlug}/pull-requests/new?${params.toString()}`;
  }

  private async request<T>(path: string): Promise<T> {
    const auth = await this.deps.getAuthHeader();
    if (!auth) {
      throw new Error("GitNexus: no Bitbucket credentials. Run “GitNexus: Set Bitbucket Credentials” first.");
    }
    const response = await this.fetchFn(`${this.apiBase}${path}`, {
      headers: { authorization: auth, accept: "application/json" }
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Bitbucket API ${response.status} for ${path}: ${body.slice(0, 200)}`);
    }
    return (await response.json()) as T;
  }
}
