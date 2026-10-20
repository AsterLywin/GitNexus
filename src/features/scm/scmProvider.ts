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
    this.refresh();
  }

  refresh(): void {
    const snapshot = this.store.get(this.root.fsPath);
    if (!snapshot) return;
    const staged = snapshot.status.entries
      .filter(e => e.indexStatus !== ".")
      .map(e => this.state(e.path, "gitnexus.unstage", "Unstage"));
    const unstaged = snapshot.status.entries
      .filter(e => e.worktreeStatus !== "." || e.kind === "untracked")
      .map(e => this.state(e.path, "gitnexus.stage", "Stage"));
    this.indexGroup.resourceStates = staged;
    this.worktreeGroup.resourceStates = unstaged;
    this.scm.count = snapshot.status.entries.length;
  }

  private state(filePath: string, command: string, title: string): vscode.SourceControlResourceState {
    const uri = vscode.Uri.joinPath(this.root, filePath);
    // SourceControlResourceState is an interface in the VS Code API, not a
    // constructable class — return a plain object implementing it.
    return {
      resourceUri: uri,
      command: { command, title, arguments: [uri] },
      decorations: {
        tooltip: filePath,
        strikeThrough: false,
        faded: false
      }
    };
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.scm.dispose();
  }
}
