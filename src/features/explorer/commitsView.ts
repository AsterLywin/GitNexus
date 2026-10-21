import * as vscode from "vscode";
import { CommitSummary } from "../../domain/git";
import { RepositoryStateStore } from "../../state/repositoryStateStore";
import { commitNodes } from "./models";
import { SnapshotTreeProvider, placeholderItem } from "./snapshotTree";

export class CommitTreeItem extends vscode.TreeItem {
  constructor(
    readonly root: string,
    readonly commit: CommitSummary
  ) {
    super(commit.subject || commit.id.slice(0, 8), vscode.TreeItemCollapsibleState.None);
    this.description = `${commit.authorName} · ${commit.id.slice(0, 8)}`;
    this.tooltip = new vscode.MarkdownString(
      `**${commit.subject}**\n\n${commit.authorName} &lt;${commit.authorEmail}&gt;\n\n${new Date(commit.authorTimestamp * 1000).toLocaleString()} · \`${commit.id}\``
    );
    this.contextValue = "commit";
    this.iconPath = new vscode.ThemeIcon("git-commit");
    this.command = {
      command: "gitnexus.showCommit",
      title: "Show Commit",
      arguments: [commit.id]
    };
  }
}

/** Commits view: the snapshot's recent history for the current branch. */
export class CommitsViewProvider extends SnapshotTreeProvider<vscode.TreeItem> {
  constructor(store: RepositoryStateStore, resolveRoot: () => Promise<string | undefined>) {
    super(store, resolveRoot);
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(): Promise<vscode.TreeItem[]> {
    const snapshot = await this.snapshot();
    if (!snapshot) return [placeholderItem("No repository open")];
    if (snapshot.commits.length === 0) return [placeholderItem("No commits yet")];
    const root = snapshot.identity.rootUri;
    return commitNodes(snapshot.commits).map(node => new CommitTreeItem(root, node.commit));
  }
}
