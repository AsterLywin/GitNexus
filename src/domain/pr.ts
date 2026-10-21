/**
 * Layer C — external state (REPOSITORY_STATE_MODEL §3): pull requests are
 * provider data, never authoritative Git state. The provider interface is
 * host-neutral; GitHub is the first adapter.
 */

export type PullRequestState = "open" | "closed" | "merged";
export type ReviewStatus = "approved" | "changes-requested" | "pending" | "none";
export type CiStatus = "success" | "failure" | "pending" | "unknown";

export interface PullRequestSummary {
  id: string;
  number: number;
  title: string;
  state: PullRequestState;
  author: string;
  headBranch: string;
  headSha: string;
  baseBranch: string;
  url: string;
  reviewStatus?: ReviewStatus;
  ciStatus?: CiStatus;
  /** True when the head branch lives in a different repository (fork). */
  fork?: boolean;
}

export interface IssueSummary {
  id: string;
  number: number;
  title: string;
  state: "open" | "closed";
  author: string;
  url: string;
  labels: string[];
}

export interface PullRequestProvider {
  readonly id: string;
  readonly displayName: string;
  /** The remote this provider instance is bound to, e.g. "owner/repo". */
  readonly repositorySlug: string;
  listOpen(): Promise<PullRequestSummary[]>;
  forBranch(branch: string): Promise<PullRequestSummary | undefined>;
  /** Web URL that starts a new PR from head into base. */
  createUrl(baseBranch: string, headBranch: string): string;
  /** Open issues (Launchpad); optional per provider. */
  listIssues?(): Promise<IssueSummary[]>;
}
