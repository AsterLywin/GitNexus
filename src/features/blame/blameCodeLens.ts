import * as vscode from "vscode";
import { BlameCache } from "./blameCache";
import { BlameLine } from "./blameService";
import { blameForDocument } from "./documentBlame";
import { formatRelativeTime } from "./format";

interface FlatSymbol {
  name: string;
  line: number;
}

/**
 * GitLens-style CodeLens: instead of one lens per line, a file-level
 * lens on line 1 (most recent change) plus one lens per function/class
 * (from the document symbol provider) showing who last touched it.
 * Clicking a lens opens the commit (gitnexus.showCommit).
 */
export class BlameCodeLensProvider implements vscode.CodeLensProvider {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.changeEmitter.event;

  constructor(private readonly cache: BlameCache) {}

  async provideCodeLenses(
    document: vscode.TextDocument,
    token: vscode.CancellationToken
  ): Promise<vscode.CodeLens[]> {
    if (token.isCancellationRequested) return [];
    if (!vscode.workspace.getConfiguration("gitnexus").get<boolean>("blame.codeLens.enabled", true)) {
      return [];
    }
    if (document.uri.scheme !== "file") return [];

    const target = this.cache.targetFor(document.uri.fsPath);
    if (!target) return [];

    let lines: BlameLine[];
    try {
      lines = await blameForDocument(this.cache, target, document);
    } catch {
      return [];
    }
    if (token.isCancellationRequested || lines.length === 0) return [];

    const byLine = new Map(lines.map(l => [l.line, l]));
    const lenses: vscode.CodeLens[] = [];

    // File-level lens: the most recent change anywhere in the file.
    const newest = lines.reduce((a, b) => (b.timestamp > a.timestamp ? b : a), lines[0]);
    lenses.push(new vscode.CodeLens(new vscode.Range(0, 0, 0, 0), {
      title: newest.uncommitted
        ? "Uncommitted changes"
        : `${newest.author}, ${formatRelativeTime(newest.timestamp)} • ${truncate(newest.summary, 60)}`,
      command: "gitnexus.showCommit",
      arguments: [newest.commit]
    }));

    // Symbol lenses: last author per function/method/class.
    const symbols = await this.symbolsOf(document.uri);
    const seen = new Set<number>();
    for (const symbol of symbols.slice(0, 200)) {
      if (seen.has(symbol.line)) continue;
      seen.add(symbol.line);
      const entry = byLine.get(symbol.line + 1);
      if (!entry || entry.line === newest.line && symbol.line === 0) continue;
      lenses.push(new vscode.CodeLens(
        new vscode.Range(symbol.line, 0, symbol.line, 0),
        {
          title: entry.uncommitted
            ? "Uncommitted changes"
            : `${entry.author}, ${formatRelativeTime(entry.timestamp)}`,
          command: "gitnexus.showCommit",
          arguments: [entry.commit]
        }
      ));
    }
    return lenses;
  }

  private async symbolsOf(uri: vscode.Uri): Promise<FlatSymbol[]> {
    try {
      const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
        "vscode.executeDocumentSymbolProvider",
        uri
      );
      if (!symbols) return [];
      const flat: FlatSymbol[] = [];
      const walk = (items: vscode.DocumentSymbol[]): void => {
        for (const item of items) {
          if (
            item.kind === vscode.SymbolKind.Function ||
            item.kind === vscode.SymbolKind.Method ||
            item.kind === vscode.SymbolKind.Class ||
            item.kind === vscode.SymbolKind.Constructor
          ) {
            flat.push({ name: item.name, line: item.range.start.line });
          }
          walk(item.children);
        }
      };
      walk(symbols);
      return flat.sort((a, b) => a.line - b.line);
    } catch {
      return [];
    }
  }

  refresh(): void {
    this.changeEmitter.fire();
  }

  dispose(): void {
    this.changeEmitter.dispose();
  }
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max - 1).trimEnd() + "…";
}
