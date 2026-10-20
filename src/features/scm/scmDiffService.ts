import * as vscode from "vscode";
import { GitProcessExecutor } from "../../git/processExecutor";

export class ScmDiffService {
  constructor(private readonly executor: GitProcessExecutor, private readonly timeoutMs = 30000) {}

  async openDiff(root: string, filePath: string): Promise<void> {
    const diff = await this.executor.exec(["diff", "--", filePath], { cwd: root, timeoutMs: this.timeoutMs });
    if (!diff.stdout.trim()) {
      const staged = await this.executor.exec(["diff", "--cached", "--", filePath], { cwd: root, timeoutMs: this.timeoutMs });
      if (staged.stdout.trim()) return this.show(root, filePath, staged.stdout);
      vscode.window.showInformationMessage(`GitNexus: no diff available for ${filePath}`);
      return;
    }
    await this.show(root, filePath, diff.stdout);
  }

  private async show(root: string, filePath: string, patch: string): Promise<void> {
    const doc = await vscode.workspace.openTextDocument({ language: "diff", content: patch });
    await vscode.window.showTextDocument(doc, { preview: false });
  }
}
