import * as vscode from "vscode";
import { RepositorySnapshot } from "../../domain/git";
import { RepositoryStateStore } from "../../state/repositoryStateStore";

/**
 * Base for the sidebar tree providers. Every view renders the CURRENT
 * repository snapshot (the state engine stays the single source of
 * truth — views never call Git directly, except Contributors which reads
 * through GitService and caches per generation). Providers refresh
 * automatically whenever the store publishes a new snapshot.
 */
export abstract class SnapshotTreeProvider<T extends vscode.TreeItem>
  implements vscode.TreeDataProvider<T> {
  private readonly emitter = new vscode.EventEmitter<T | undefined | void>();
  readonly onDidChangeTreeData = this.emitter.event;
  private readonly unsubscribe: () => void;

  protected constructor(
    protected readonly store: RepositoryStateStore,
    protected readonly resolveRoot: () => Promise<string | undefined>
  ) {
    this.unsubscribe = store.onChanged(() => this.refresh());
  }

  refresh(): void {
    this.emitter.fire();
  }

  /** The snapshot for the resolved workspace root (first snapshot as fallback). */
  protected async snapshot(): Promise<RepositorySnapshot | undefined> {
    const root = await this.resolveRoot().catch(() => undefined);
    if (root) {
      const snapshot = this.store.get(root);
      if (snapshot) return snapshot;
    }
    return this.store.all()[0];
  }

  dispose(): void {
    this.unsubscribe();
    this.emitter.dispose();
  }

  abstract getTreeItem(element: T): vscode.TreeItem;
  abstract getChildren(element?: T): Promise<T[]>;
}

export function placeholderItem(text: string): vscode.TreeItem {
  const item = new vscode.TreeItem(text, vscode.TreeItemCollapsibleState.None);
  item.contextValue = "placeholder";
  return item;
}
