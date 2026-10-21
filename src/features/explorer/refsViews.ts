import * as vscode from "vscode";
import { GitRef } from "../../domain/ref";
import { GitRemote } from "../../git/remoteService";
import { RepositoryStateStore } from "../../state/repositoryStateStore";
import { branchNodes, remoteNodes, tagNodes } from "./models";
import { SnapshotTreeProvider, placeholderItem } from "./snapshotTree";

/* ---------------------------------- branches --------------------------------- */

export class BranchTreeItem extends vscode.TreeItem {
  constructor(
    readonly root: string,
    readonly ref: GitRef
  ) {
    super(ref.shortName, vscode.TreeItemCollapsibleState.None);
    const tracking: string[] = [];
    if (ref.upstream) tracking.push(`→ ${ref.upstream}`);
    if (ref.ahead) tracking.push(`↑${ref.ahead}`);
    if (ref.behind) tracking.push(`↓${ref.behind}`);
    this.description = tracking.join(" ");
    this.tooltip = ref.name;
    this.contextValue = ref.kind === "remoteBranch"
      ? "branchRemote"
      : ref.isCurrent ? "branchCurrent" : "branchLocal";
    this.iconPath = new vscode.ThemeIcon(ref.isCurrent ? "check" : "git-branch");
  }
}

class BranchGroupItem extends vscode.TreeItem {
  constructor(
    readonly group: "local" | "remote",
    count: number
  ) {
    super(group === "local" ? "Local" : "Remote", vscode.TreeItemCollapsibleState.Expanded);
    this.description = `${count}`;
    this.contextValue = "branchGroup";
    this.iconPath = new vscode.ThemeIcon(group === "local" ? "git-branch" : "cloud");
  }
}

export class BranchesViewProvider extends SnapshotTreeProvider<vscode.TreeItem> {
  constructor(store: RepositoryStateStore, resolveRoot: () => Promise<string | undefined>) {
    super(store, resolveRoot);
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    const snapshot = await this.snapshot();
    if (!snapshot?.domains) return [placeholderItem("No repository open")];
    const { branches } = snapshot.domains.refs;
    const { local, remote } = branchNodes(branches);
    const root = snapshot.identity.rootUri;

    if (!element) {
      const groups: vscode.TreeItem[] = [];
      if (local.length) groups.push(new BranchGroupItem("local", local.length));
      if (remote.length) groups.push(new BranchGroupItem("remote", remote.length));
      return groups.length ? groups : [placeholderItem("No branches")];
    }
    if (element instanceof BranchGroupItem) {
      const nodes = element.group === "local" ? local : remote;
      return nodes.map(node => new BranchTreeItem(root, node.ref));
    }
    return [];
  }
}

/* ------------------------------------ tags ----------------------------------- */

export class TagTreeItem extends vscode.TreeItem {
  constructor(
    readonly root: string,
    readonly ref: GitRef
  ) {
    super(ref.shortName, vscode.TreeItemCollapsibleState.None);
    this.description = ref.objectId.slice(0, 8);
    this.tooltip = ref.name;
    this.contextValue = "tag";
    this.iconPath = new vscode.ThemeIcon("tag");
  }
}

export class TagsViewProvider extends SnapshotTreeProvider<vscode.TreeItem> {
  constructor(store: RepositoryStateStore, resolveRoot: () => Promise<string | undefined>) {
    super(store, resolveRoot);
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(): Promise<vscode.TreeItem[]> {
    const snapshot = await this.snapshot();
    if (!snapshot?.domains) return [placeholderItem("No repository open")];
    const nodes = tagNodes(snapshot.domains.refs.tags);
    if (nodes.length === 0) return [placeholderItem("No tags")];
    const root = snapshot.identity.rootUri;
    return nodes.map(node => new TagTreeItem(root, node.ref));
  }
}

/* ---------------------------------- remotes ---------------------------------- */

export class RemoteTreeItem extends vscode.TreeItem {
  constructor(
    readonly root: string,
    readonly remote: GitRemote
  ) {
    super(remote.name, vscode.TreeItemCollapsibleState.None);
    this.description = remote.fetchUrl ?? "";
    this.tooltip = [
      remote.fetchUrl ? `fetch: ${remote.fetchUrl}` : "",
      remote.pushUrl && remote.pushUrl !== remote.fetchUrl ? `push: ${remote.pushUrl}` : ""
    ].filter(Boolean).join("\n");
    this.contextValue = "remote";
    this.iconPath = new vscode.ThemeIcon("cloud");
  }
}

export class RemotesViewProvider extends SnapshotTreeProvider<vscode.TreeItem> {
  constructor(store: RepositoryStateStore, resolveRoot: () => Promise<string | undefined>) {
    super(store, resolveRoot);
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(): Promise<vscode.TreeItem[]> {
    const snapshot = await this.snapshot();
    if (!snapshot?.domains) return [placeholderItem("No repository open")];
    const nodes = remoteNodes(snapshot.domains.remotes);
    if (nodes.length === 0) return [placeholderItem("No remotes")];
    const root = snapshot.identity.rootUri;
    return nodes.map(node => new RemoteTreeItem(root, node.remote));
  }
}
