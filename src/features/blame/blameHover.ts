import * as vscode from "vscode";
import { BlameCache } from "./blameCache";
import { BlameService } from "./blameService";
import { blameForDocument } from "./documentBlame";
import { formatRelativeTime } from "./format";
import { assembleAutolinkRules, escapeMarkdown, linkifyMarkdown } from "../commit/autolinks";

/**
 * Commit hover card for blamed lines: subject + body, author, absolute
 * and relative dates, and command links (copy hash / show commit). The
 * commit metadata comes from BlameService.commitInfo (cached).
 */
export class BlameHoverProvider implements vscode.HoverProvider {
  constructor(
    private readonly cache: BlameCache,
    private readonly blame: BlameService
  ) {}

  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken
  ): Promise<vscode.Hover | undefined> {
    if (document.uri.scheme !== "file") return undefined;
    if (!vscode.workspace.getConfiguration("gitnexus").get<boolean>("blame.hover.enabled", true)) {
      return undefined;
    }
    const target = this.cache.targetFor(document.uri.fsPath);
    if (!target) return undefined;

    let lines;
    try {
      lines = await blameForDocument(this.cache, target, document);
    } catch {
      return undefined;
    }
    if (token.isCancellationRequested) return undefined;
    const entry = lines.find(l => l.line === position.line + 1);
    if (!entry) return undefined;

    const md = new vscode.MarkdownString(undefined, true);
    md.isTrusted = true;

    if (entry.uncommitted) {
      md.appendMarkdown(`**Uncommitted changes**\n\nThis line has not been committed yet.`);
      return new vscode.Hover(md);
    }

    const info = await this.blame.commitInfo(target.root, entry.commit).catch(() => undefined);
    if (token.isCancellationRequested) return undefined;

    const subject = info?.subject || entry.summary;
    const author = info?.author || entry.author;
    const email = info?.authorEmail || entry.authorEmail;
    const timestamp = info?.timestamp || entry.timestamp;
    const date = new Date(timestamp * 1000);
    const args = encodeURIComponent(JSON.stringify([entry.commit]));
    const rules = assembleAutolinkRules(
      vscode.workspace.getConfiguration("gitnexus").get<Array<{ prefix: string; url: string }>>("autolinks", []),
      this.cache.remoteUrlsFor(target.root)
    );

    md.appendMarkdown(`**${linkifyMarkdown(subject, rules)}**\n\n`);
    if (info?.body) md.appendMarkdown(`${linkifyMarkdown(info.body, rules)}\n\n`);
    md.appendMarkdown(`---\n\n`);
    md.appendMarkdown(`${escapeMarkdown(author)}${email ? ` &lt;${escapeMarkdown(email)}&gt;` : ""} — ${date.toLocaleString()} (${formatRelativeTime(timestamp)})\n\n`);
    md.appendMarkdown(`[\`${entry.commit.slice(0, 10)}\`](command:gitnexus.copyHash?${args} "Copy full hash") · [Show commit](command:gitnexus.showCommit?${args})`);
    return new vscode.Hover(md);
  }
}
