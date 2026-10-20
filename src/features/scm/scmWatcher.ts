import * as vscode from "vscode";
import { RepositoryManager } from "../../app/repositoryManager";
import { RepositoryEventBus } from "../../state/eventBus";
import { classifyGitPath } from "./gitWatcher";

/**
 * Watches the workspace and the repository's `.git` paths (§17). Events are
 * classified into typed state events and published on the event bus; the
 * RepositoryManager coalesces bursts and answers with targeted refreshes
 * (§19). Without a bus, falls back to the legacy full-refresh debounce.
 */
export class ScmWatcher implements vscode.Disposable {
  private readonly watcher: vscode.FileSystemWatcher;
  private timer?: ReturnType<typeof setTimeout>;
  private disposed = false;

  constructor(
    private readonly root: vscode.Uri,
    private readonly repositories: RepositoryManager,
    private readonly bus?: RepositoryEventBus
  ) {
    this.watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root, "**/*"));
    const onEvent = (uri: vscode.Uri) => this.handle(uri);
    this.watcher.onDidCreate(onEvent);
    this.watcher.onDidChange(onEvent);
    this.watcher.onDidDelete(onEvent);
  }

  private handle(uri: vscode.Uri): void {
    if (this.disposed) return;
    if (this.bus) {
      const event = classifyGitPath(uri.fsPath);
      if (event) this.bus.emit(this.root.fsPath, event);
      return;
    }
    this.schedule();
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
