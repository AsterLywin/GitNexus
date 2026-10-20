import * as vscode from "vscode";
import { BlameService } from "./blameService";

export class BlameCodeLensProvider implements vscode.CodeLensProvider {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.changeEmitter.event;

  constructor(private readonly blame: BlameService) {}

  async provideCodeLenses(
    document: vscode.TextDocument,
    token: vscode.CancellationToken
  ): Promise<vscode.CodeLens[]> {
    if (token.isCancellationRequested) return [];

    const root = vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath;
    if (!root) return [];

    try {
      const lines = await this.blame.blame(root, document.uri.fsPath);
      return lines.map(item => new vscode.CodeLens(
        new vscode.Range(item.line - 1, 0, item.line - 1, 0),
        {
          title: `${item.author} · ${item.commit.slice(0, 8)}`,
          command: "gitnexus.showCommit",
          arguments: [item.commit]
        }
      ));
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
