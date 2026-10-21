/** Pure prompt builders for the AI features (unit-tested). */

const MAX_DIFF_CHARS = 8000;

export function truncateDiff(diff: string): string {
  if (diff.length <= MAX_DIFF_CHARS) return diff;
  return `${diff.slice(0, MAX_DIFF_CHARS)}\n… [diff truncated]`;
}

export function buildCommitMessagePrompt(stagedDiff: string): string {
  return [
    "Write a Git commit message for the staged changes below.",
    "Rules: first line is a concise imperative summary of at most 72 characters;",
    "optionally follow with a blank line and a short body explaining what changed and why;",
    "reply with ONLY the commit message, no code fences, no commentary.",
    "",
    "Staged diff:",
    truncateDiff(stagedDiff)
  ].join("\n");
}

export function buildExplainCommitPrompt(subject: string, body: string, diff: string): string {
  return [
    "Explain this Git commit to a fellow developer.",
    "Cover: what changed, why it likely changed, and anything risky or worth reviewing.",
    "Be concise, use short Markdown sections and bullets.",
    "",
    `Commit subject: ${subject}`,
    body ? `Commit body:\n${body}` : "",
    "",
    "Diff:",
    truncateDiff(diff)
  ].filter(Boolean).join("\n");
}
