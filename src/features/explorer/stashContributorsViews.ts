import * as vscode from "vscode";
import { GitService } from "../../git/gitService";
import { ContributorSummary } from "../../git/parsers/shortlogParser";
import { RepositoryStateStore } from "../../state/repositoryStateStore";
import { StashEntry } from "../stash/stashService";
import { stashNodes } from "./models";
import { SnapshotTreeProvider, placeholderItem } from "./snapshotTree";

/* ----------------------------------- stashes ---------------------------------- */

export class StashTreeItem extends vscode.TreeItem {
  constructor(
    readonly root: string,
    readonly entry: StashEntry
  ) {
    super(entry.subject || entry.ref, vscode.TreeItemCollapsibleState.None);
    this.description = entry.ref;
    this.contextValue = "stash";
    this.iconPath = new vscode.ThemeIcon("archive");
  }
}

export class StashesViewProvider extends SnapshotTreeProvider<vscode.TreeItem> {
  constructor(store: RepositoryStateStore, resolveRoot: () => Promise<string | undefined>) {
    super(store, resolveRoot);
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(): Promise<vscode.TreeItem[]> {
    const snapshot = await this.snapshot();
    if (!snapshot?.domains) return [placeholderItem("No repository open")];
    const nodes = stashNodes(snapshot.domains.stashes);
    if (nodes.length === 0) return [placeholderItem("No stashes")];
    const root = snapshot.identity.rootUri;
    return nodes.map(node => new StashTreeItem(root, node.entry));
  }
}

/* -------------------------------- contributors -------------------------------- */

export class ContributorTreeItem extends vscode.TreeItem {
  constructor(readonly contributor: ContributorSummary) {
    super(contributor.name, vscode.TreeItemCollapsibleState.None);
    this.description = `${contributor.commits} commit${contributor.commits === 1 ? "" : "s"}`;
    this.tooltip = contributor.email;
    this.contextValue = "contributor";
    this.iconPath = new vscode.ThemeIcon("person");
  }
}

/**
 * Contributors view: author ranking from `git shortlog`, cached per
 * snapshot generation (the one view that reads through GitService —
 * contributor aggregation is not a snapshot domain).
 */
export class ContributorsViewProvider extends SnapshotTreeProvider<vscode.TreeItem> {
  private cache: { root: string; generation: number; rows: ContributorSummary[] } | undefined;

  constructor(
    store: RepositoryStateStore,
    resolveRoot: () => Promise<string | undefined>,
    private readonly git: GitService
  ) {
    super(store, resolveRoot);
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(): Promise<vscode.TreeItem[]> {
    const snapshot = await this.snapshot();
    if (!snapshot) return [placeholderItem("No repository open")];
    const root = snapshot.identity.rootUri;
    if (this.cache?.root !== root || this.cache.generation !== snapshot.generation) {
      const rows = await this.git.contributors(root).catch(() => [] as ContributorSummary[]);
      this.cache = { root, generation: snapshot.generation, rows };
    }
    if (this.cache.rows.length === 0) return [placeholderItem("No contributors yet")];
    return this.cache.rows.map(row => new ContributorTreeItem(row));
  }
}
