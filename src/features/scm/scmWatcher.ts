import * as vscode from "vscode";
import { RepositoryManager } from "../../app/repositoryManager";

export class ScmWatcher implements vscode.Disposable {
  private readonly watcher: vscode.FileSystemWatcher;
  private timer?: ReturnType<typeof setTimeout>;
  private disposed = false;

  constructor(private readonly root: vscode.Uri, private readonly repositories: RepositoryManager) {
    this.watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root, "**/*"));
    const refresh = () => this.schedule();
    this.watcher.onDidCreate(refresh);
    this.watcher.onDidChange(refresh);
    this.watcher.onDidDelete(refresh);
  }

  private schedule(): void {
    if (this.disposed) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.repositories.refresh(this.root.fsPath).catch(() => undefined);
    }, 180);
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    this.watcher.dispose();
  }
}
