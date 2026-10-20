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
    this.disposables.push(store.onChanged(s => {
      if (s.identity.rootUri === root.fsPath) this.refresh();
    }));
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
    const state = new vscode.SourceControlResourceState(uri);
    state.command = { command, title, arguments: [uri] };
    state.decorations = {
      tooltip: filePath,
      strikeThrough: false,
      faded: false
    };
    return state;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.scm.dispose();
  }
}
