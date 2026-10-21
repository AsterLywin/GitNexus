export interface ContributorSummary {
  name: string;
  email: string;
  commits: number;
}

/**
 * Parse `git shortlog -sne` output:
 *   "   128\tAda Lovelace <ada@example.com>"
 * Sorted by commit count descending (Git's own order is preserved).
 */
export function parseShortlog(raw: string): ContributorSummary[] {
  const contributors: ContributorSummary[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^\s*(\d+)\t(.*) <([^>]*)>\s*$/);
    if (!match) continue;
    contributors.push({
      commits: Number(match[1]),
      name: match[2],
      email: match[3]
    });
  }
  return contributors;
}
