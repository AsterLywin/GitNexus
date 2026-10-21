/**
 * Autolinks (GitLens-style): turn issue/ticket references in commit
 * text into Markdown links. Two sources:
 *  - user rules from `gitnexus.autolinks` config: { prefix, url } where
 *    the URL template contains `<num>` (e.g. prefix "PROJ-" →
 *    "https://jira.example.com/browse/<num>");
 *  - the repository's remote: "#123" → that repo's issues on GitHub,
 *    GitLab or Bitbucket.
 * Pure and unit-tested; callers assemble rules from config + remotes.
 */

import { issueWebUrlTemplate } from "../pr/remoteInfo";

export interface AutolinkRule {
  prefix: string;
  /** URL template; `<num>` is replaced with the matched reference id. */
  urlTemplate: string;
}

/** "owner/repo" from any GitHub remote spelling, or undefined. */
export function githubRemotePath(remoteUrl: string): string | undefined {
  const cleaned = remoteUrl.trim().replace(/\.git$/, "");
  const https = cleaned.match(/^https?:\/\/github\.com\/([^/]+\/[^/]+)$/);
  if (https) return https[1];
  const ssh = cleaned.match(/^(?:ssh:\/\/)?git@github\.com[:/]([^/]+\/[^/]+)$/);
  if (ssh) return ssh[1];
  return undefined;
}

export function assembleAutolinkRules(
  configRules: Array<{ prefix: string; url: string }>,
  remoteUrls: string[]
): AutolinkRule[] {
  const rules: AutolinkRule[] = configRules
    .filter(rule => rule.prefix && rule.url)
    .map(rule => ({ prefix: rule.prefix, urlTemplate: rule.url }));
  for (const url of remoteUrls) {
    const template = issueWebUrlTemplate(url);
    if (template) {
      rules.push({ prefix: "#", urlTemplate: template });
      break;
    }
  }
  return rules;
}

export function escapeMarkdown(text: string): string {
  return text.replace(/([\\`*_{}[\]()#+\-.!|>])/g, "\\$1");
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Linkify raw commit text into Markdown: segments between matches are
 * Markdown-escaped; each reference becomes [text](url). A reference is
 * the rule's prefix followed by an id containing at least one digit,
 * not glued to a preceding word character (so URLs and words that
 * merely contain the prefix are left alone).
 */
export function linkifyMarkdown(raw: string, rules: AutolinkRule[]): string {
  if (rules.length === 0) return escapeMarkdown(raw);
  const alternatives = rules.map((rule, index) =>
    `(?<p${index}>${escapeRegExp(rule.prefix)})(?<n${index}>[A-Za-z0-9_-]*\\d[A-Za-z0-9_-]*)`
  );
  const pattern = new RegExp(`(?<![A-Za-z0-9_/.-])(?:${alternatives.join("|")})`, "g");

  let output = "";
  let lastIndex = 0;
  for (const match of raw.matchAll(pattern)) {
    const index = match.index ?? 0;
    output += escapeMarkdown(raw.slice(lastIndex, index));
    let ruleIndex = rules.findIndex((_, i) => match.groups?.[`p${i}`] !== undefined);
    if (ruleIndex < 0) ruleIndex = 0;
    const id = match.groups?.[`n${ruleIndex}`] ?? "";
    const url = rules[ruleIndex].urlTemplate.replace(/<num>/g, encodeURIComponent(id));
    output += `[${escapeMarkdown(match[0])}](${url})`;
    lastIndex = index + match[0].length;
  }
  output += escapeMarkdown(raw.slice(lastIndex));
  return output;
}
