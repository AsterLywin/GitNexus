import * as vscode from "vscode";
import { RepositoryStateStore } from "../../state/repositoryStateStore";
import { GitProcessExecutor } from "../../git/processExecutor";

export class GitNexusScmProvider implements vscode.Disposable {
  readonly scm: vscode.SourceControl;
  private readonly indexGroup: vscode.SourceControlResourceGroup;
  private readonly worktreeGroup: vscode.SourceControlResourceGroup;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly root: vscode.Uri,
    private readonly store: RepositoryStateStore,
    private readonly executor: GitProcessExecutor
  ) {
    this.scm = vscode.scm.createSourceControl("gitnexus", "GitNexus", root);
    this.scm.acceptInputCommand = {
      command: "gitnexus.commit",
      title: "Commit",
      arguments: []
    };
    this.scm.inputBox.placeholder = "Commit message";
    this.indexGroup = this.scm.createResourceGroup("staged", "Staged Changes");
    this.worktreeGroup = this.scm.createResourceGroup("changes", "Changes");
    this.disposables.push(new vscode.Disposable(store.onChanged(s => {
      if (s.identity.rootUri === root.fsPath) this.refresh();
    })));
    this.disposables.push(
      vscode.window.registerFileDecorationProvider(new ScmFileDecorationProvider(root, store))
    );
    this.refresh();
  }

  refresh(): void {
    const snapshot = this.store.get(this.root.fsPath);
    if (!snapshot) return;
    const staged = snapshot.status.entries
      .filter(e => e.indexStatus !== ".")
      .map(e => this.state(e, "gitnexus.unstage", "Unstage"));
    const unstaged = snapshot.status.entries
      .filter(e => e.worktreeStatus !== "." || e.kind === "untracked")
      .map(e => this.state(e, "gitnexus.stage", "Stage"));
    this.indexGroup.resourceStates = staged;
    this.worktreeGroup.resourceStates = unstaged;
    this.scm.count = snapshot.status.entries.length;
  }

  private state(
    entry: import("../../domain/git").WorkingTreeEntry,
    command: string,
    title: string
  ): vscode.SourceControlResourceState {
    const uri = vscode.Uri.joinPath(this.root, entry.path);
    // SourceControlResourceState is an interface in the VS Code API, not a
    // constructable class — return a plain object implementing it.
    return {
      resourceUri: uri,
      command: { command, title, arguments: [uri] },
      decorations: {
        tooltip: entry.originalPath
          ? `${entry.originalPath} → ${entry.path}`
          : `${entry.path} (${entry.kind})`,
        strikeThrough: entry.kind === "deleted",
        faded: entry.kind === "ignored"
      }
    };
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.scm.dispose();
  }
}

const KIND_BADGES: Record<string, string> = {
  modified: "M", added: "A", deleted: "D", renamed: "R",
  copied: "C", unmerged: "!", untracked: "?", ignored: "I"
};

const KIND_COLORS: Record<string, string> = {
  modified: "gitDecoration.modifiedResourceForeground",
  added: "gitDecoration.addedResourceForeground",
  deleted: "gitDecoration.deletedResourceForeground",
  renamed: "gitDecoration.renamedResourceForeground",
  copied: "gitDecoration.renamedResourceForeground",
  unmerged: "gitDecoration.conflictingResourceForeground",
  untracked: "gitDecoration.untrackedResourceForeground",
  ignored: "gitDecoration.ignoredResourceForeground"
};

/**
 * Explorer/SCM file badges and colors for changed files, driven by the
 * same state-model snapshot as the resource groups (letter badge per
 * change kind, Git's standard theme colors).
 */
export class ScmFileDecorationProvider implements vscode.FileDecorationProvider {
  constructor(
    private readonly root: vscode.Uri,
    private readonly store: RepositoryStateStore
  ) {}

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    if (uri.scheme !== "file") return undefined;
    const snapshot = this.store.get(this.root.fsPath);
    if (!snapshot) return undefined;
    const relative = uri.fsPath.startsWith(this.root.fsPath)
      ? uri.fsPath.slice(this.root.fsPath.length).replace(/^[/\\]/, "")
      : undefined;
    if (!relative) return undefined;
    const entry = snapshot.status.entries.find(e => e.path === relative);
    if (!entry) return undefined;
    return {
      badge: KIND_BADGES[entry.kind] ?? "•",
      color: new vscode.ThemeColor(KIND_COLORS[entry.kind] ?? "gitDecoration.modifiedResourceForeground"),
      tooltip: entry.originalPath ? `${entry.originalPath} → ${entry.path}` : entry.kind
    };
  }
}
