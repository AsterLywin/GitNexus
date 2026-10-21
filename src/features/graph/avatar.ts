import { createHash } from "node:crypto";

/**
 * Gravatar avatar URL for an author email (the graph's author imagery,
 * same convention as GitLens). `d=identicon` gives every author a stable
 * generated avatar even without a Gravatar account.
 */
export function gravatarUrl(email: string, size = 32): string | undefined {
  const normalized = email.trim().toLowerCase();
  if (!normalized || !normalized.includes("@")) return undefined;
  const md5 = createHash("md5").update(normalized).digest("hex");
  return `https://www.gravatar.com/avatar/${md5}?s=${size}&d=identicon`;
}
