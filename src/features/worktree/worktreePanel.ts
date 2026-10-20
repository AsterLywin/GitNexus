import * as vscode from "vscode";
import { Worktree, WorktreeService } from "./worktreeService";

export class WorktreeTreeItem extends vscode.TreeItem {
  constructor(readonly worktree: Worktree, readonly isMain: boolean) {
    super(worktree.branch ?? "(detached HEAD)", vscode.TreeItemCollapsibleState.None);
    this.description = [
      worktree.head?.slice(0, 8) ?? "",
      worktree.locked ? "locked" : "",
      worktree.prunable ? "prunable" : "",
      isMain ? "main" : ""
    ].filter(Boolean).join(" · ");
    this.tooltip = worktree.path;
    this.contextValue =
      (isMain ? "worktreeMain" : "worktree") + (worktree.locked ? "Locked" : "");
    this.iconPath = new vscode.ThemeIcon(worktree.locked ? "lock" : "folder-opened");
  }
}

/**
 * Worktrees tree view (explorer). The first entry of `git worktree list`
 * is the main worktree; it cannot be removed or moved. Mutations live in
 * the gitnexus.worktree* commands; this provider only lists and refreshes.
 */
export class WorktreePanel implements vscode.TreeDataProvider<WorktreeTreeItem> {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;

  private items: WorktreeTreeItem[] = [];

  constructor(
    private readonly service: WorktreeService,
    private readonly resolveRoot: () => Promise<string | undefined>
  ) {}

  async refresh(): Promise<void> {
    const root = await this.resolveRoot().catch(() => undefined);
    if (!root) {
      this.items = [];
    } else {
      const worktrees = await this.service.list(root).catch(() => [] as Worktree[]);
      this.items = worktrees.map((worktree, index) => new WorktreeTreeItem(worktree, index === 0));
    }
    this.emitter.fire();
  }

  getTreeItem(item: WorktreeTreeItem): vscode.TreeItem {
    return item;
  }

  getChildren(): WorktreeTreeItem[] {
    return this.items;
  }
}
