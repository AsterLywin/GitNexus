/**
 * Git version parsing and capability detection (GIT_ENGINE_SPEC §8).
 * Features declare minimum versions or degrade gracefully based on these.
 */

export interface GitVersion {
  major: number;
  minor: number;
  patch: number;
  /** Raw suffix after the numeric version, e.g. ".windows.1" or "" . */
  suffix: string;
  raw: string;
}

export interface GitCapabilities {
  version: GitVersion;
  worktrees: boolean;
  porcelainV2: boolean;
  pathspecFromFile: boolean;
  sparseCheckout: boolean;
  partialClone: boolean;
  commitGraph: boolean;
  notes: boolean;
  rerere: boolean;
}

/** Parse output like "git version 2.45.2.windows.1". Returns undefined if unparsable. */
export function parseGitVersion(raw: string): GitVersion | undefined {
  const match = raw.trim().match(/git version (\d+)\.(\d+)(?:\.(\d+))?(.*)/i);
  if (!match) return undefined;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3] ?? 0),
    suffix: match[4] ?? "",
    raw: raw.trim()
  };
}

/** Negative if a < b, 0 if equal, positive if a > b. */
export function compareGitVersion(
  a: Pick<GitVersion, "major" | "minor" | "patch">,
  b: Pick<GitVersion, "major" | "minor" | "patch">
): number {
  return (a.major - b.major) || (a.minor - b.minor) || (a.patch - b.patch);
}

export function gitVersionAtLeast(
  version: GitVersion,
  major: number,
  minor: number,
  patch = 0
): boolean {
  return compareGitVersion(version, { major, minor, patch }) >= 0;
}

export function detectCapabilities(version: GitVersion): GitCapabilities {
  return {
    version,
    // git worktree shipped in 2.5
    worktrees: gitVersionAtLeast(version, 2, 5),
    // git status --porcelain=v2 shipped in 2.11
    porcelainV2: gitVersionAtLeast(version, 2, 11),
    // --pathspec-from-file shipped in 2.26
    pathspecFromFile: gitVersionAtLeast(version, 2, 26),
    // sparse-checkout subcommand shipped in 2.25
    sparseCheckout: gitVersionAtLeast(version, 2, 25),
    // --filter partial clone shipped in 2.19
    partialClone: gitVersionAtLeast(version, 2, 19),
    // commit-graph file support shipped in 2.24
    commitGraph: gitVersionAtLeast(version, 2, 24),
    // git notes shipped in 1.6.5; universally available in supported installs
    notes: gitVersionAtLeast(version, 1, 7),
    // rerere shipped in 1.6; universally available in supported installs
    rerere: gitVersionAtLeast(version, 1, 7)
  };
}

/** Oldest Git version GitNexus supports (porcelain v2 is a hard requirement). */
export const MINIMUM_GIT_VERSION = { major: 2, minor: 11, patch: 0 } as const;

export function isSupportedGitVersion(version: GitVersion): boolean {
  return compareGitVersion(version, MINIMUM_GIT_VERSION) >= 0;
}
