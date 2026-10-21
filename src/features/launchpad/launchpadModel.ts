/** Launchpad data model + pure helpers (unit-tested). */

export interface LaunchpadItem {
  kind: "pr" | "issue";
  providerId: string;
  providerName: string;
  repoSlug: string;
  root: string;
  number: number;
  title: string;
  author: string;
  url: string;
  headBranch?: string;
  baseBranch?: string;
  fork?: boolean;
  labels?: string[];
}

/**
 * Fetch refspec that materializes a PR's head as local branch
 * `pr-<number>`. GitHub and GitLab expose stable PR refs that work
 * for forks too; Bitbucket has none, so its (same-repo) source branch
 * is fetched directly.
 */
export function prCheckoutRefspec(providerId: string, pr: { number: number; headBranch: string }): string {
  switch (providerId) {
    case "github": return `pull/${pr.number}/head:pr-${pr.number}`;
    case "gitlab": return `merge-requests/${pr.number}/head:pr-${pr.number}`;
    default: return `${pr.headBranch}:pr-${pr.number}`;
  }
}

/** Whether the Checkout action can work for this PR at all. */
export function canCheckout(item: LaunchpadItem): boolean {
  if (item.kind !== "pr") return false;
  // Bitbucket fork PRs have no fetchable ref in this repository.
  if (item.providerId === "bitbucket" && item.fork) return false;
  return true;
}

/** Branch name for "start work on this issue": `<number>-<slug>`. */
export function slugifyIssueBranch(number: number, title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return slug ? `${number}-${slug}` : `${number}-issue`;
}

/** PRs first (grouped by repo, newest number first), then issues. */
export function sortLaunchpadItems(items: LaunchpadItem[]): LaunchpadItem[] {
  const rank = (item: LaunchpadItem) => (item.kind === "pr" ? 0 : 1);
  return [...items].sort((a, b) =>
    rank(a) - rank(b)
    || a.repoSlug.localeCompare(b.repoSlug)
    || b.number - a.number
  );
}
