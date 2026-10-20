import * as vscode from "vscode";
import * as path from "node:path";
import { NodeGitProcessExecutor } from "./git/processExecutor";
import { GitService } from "./git/gitService";
import { RepositoryStateStore } from "./state/repositoryStateStore";
import { RepositoryManager } from "./app/repositoryManager";
import { CommandRegistry } from "./app/commandRegistry";
import { GraphService } from "./features/graph/graphService";
import { InteractiveGraphPanel } from "./features/graph/graphPanel";
import { CommitDetailsService } from "./features/commit/commitDetailsService";
import { BlameService } from "./features/blame/blameService";
import { BlameCodeLensProvider } from "./features/blame/blameCodeLens";
import { FileHistoryService } from "./features/history/fileHistoryService";
import { CompareService } from "./features/compare/compareService";
import { RefService } from "./git/refService";
import { buildRefDecorations } from "./features/graph/refDecorations";
import { CommitSearchService } from "./features/search/commitSearch";
import { parseCommitSearch } from "./features/search/searchParser";
import { RebaseService } from "./features/rebase/rebaseService";
import { WorktreeService } from "./features/worktree/worktreeService";
import { RepositoryOperationDetector } from "./git/repositoryOperationDetector";
import { MutationCoordinator } from "./app/mutationCoordinator";
import { GitNexusScmProvider } from "./features/scm/scmProvider";
import { BranchService } from "./features/branch/branchService";
import { RebasePlanner } from "./features/rebase/rebasePlanner";
import { ScmDiffService } from "./features/scm/scmDiffService";
import { ScmWatcher } from "./features/scm/scmWatcher";
import { StashService } from "./features/stash/stashService";
import { ConflictService } from "./features/conflicts/conflictService";
import { ConflictPanel } from "./features/conflicts/conflictPanel";

export function activate(context: vscode.ExtensionContext): void {
  const config = vscode.workspace.getConfiguration("gitnexus");
  const gitPath = config.get<string>("gitPath", "git");
  const timeoutMs = config.get<number>("gitTimeoutMs", 30000);

  const executor = new NodeGitProcessExecutor(gitPath);
  const git = new GitService(executor, timeoutMs);
  const store = new RepositoryStateStore();
  const repositories = new RepositoryManager(git, store);
  const graph = new GraphService(git);
  const commitDetails = new CommitDetailsService(executor, timeoutMs);
  const blame = new BlameService(executor, timeoutMs);
  const fileHistory = new FileHistoryService(executor, timeoutMs);
  const compare = new CompareService(executor, timeoutMs);
  const refs = new RefService(executor, timeoutMs);
  const search = new CommitSearchService(executor, timeoutMs);
  const worktrees = new WorktreeService(executor, timeoutMs);
  const detector = new RepositoryOperationDetector(executor, 10000);
  const mutation = new MutationCoordinator(executor, detector);
  const rebase = new RebaseService(mutation, detector);
  const scmProviders: GitNexusScmProvider[] = [];
  const branches = new BranchService(executor, timeoutMs);
  const rebasePlanner = new RebasePlanner(executor, 120000);
  const scmDiff = new ScmDiffService(executor, timeoutMs);
  const stash = new StashService(executor, timeoutMs);
  const conflicts = new ConflictService(executor);
  const commands = new CommandRegistry();

  commands.register("gitnexus.openGraph", async () => {
    try {
      const root = await resolveWorkspacePath();
      if (!root) return;
      const data = await graph.build(root, 500);
      const refSnapshot = await refs.list(root);
      const decorations = buildRefDecorations(data, refSnapshot);
      InteractiveGraphPanel.open(context, data, decorations, async commitId => {
        try {
          const details = await commitDetails.get(root, commitId);
          const document = await vscode.workspace.openTextDocument({
            language: "diff",
            content: details.diff || `Commit ${details.commit.id}\n\n${details.commit.subject}\n`
          });
          await vscode.window.showTextDocument(document, { preview: false });
        } catch (error) {
          showError(error);
        }
      });
    } catch (error) {
      showError(error);
    }
  });

  commands.register("gitnexus.refreshRepository", async () => {
    try {
      const root = await resolveWorkspacePath();
      if (!root) return;
      const snapshot = await repositories.refresh(root);
      vscode.window.showInformationMessage(
        `GitNexus: refreshed ${snapshot.status.branch ?? "(detached)"} — ` +
        `${snapshot.status.entries.length} change(s), ${snapshot.commits.length} commits`
      );
    } catch (error) {
      showError(error);
    }
  });

  commands.register("gitnexus.showStatus", async () => {
    try {
      const root = await resolveWorkspacePath();
      if (!root) return;
      const snapshot = await repositories.refresh(root);
      const s = snapshot.status;
      vscode.window.showInformationMessage(
        `${s.isClean ? "Clean" : `${s.entries.length} change(s)`}` +
        ` · ${s.branch ?? "(detached)"}` +
        ` · ahead ${s.ahead}, behind ${s.behind}`
      );
    } catch (error) {
      showError(error);
    }
  });


  commands.register("gitnexus.searchCommits", async () => {
    try {
      const root = await resolveWorkspacePath();
      if (!root) return;
      const input = await vscode.window.showInputBox({
        prompt: "GitNexus commit search",
        placeHolder: 'author:Alice message:"fix login" file:src/auth.ts after:2026-01-01'
      });
      if (!input) return;
      const results = await search.search(root, parseCommitSearch(input));
      const text = results.map(c => `${c.id.slice(0, 10)}  ${c.authorName}  ${c.subject}`).join("\n");
      const document = await vscode.workspace.openTextDocument({
        language: "text",
        content: text || "No commits found."
      });
      await vscode.window.showTextDocument(document, { preview: false });
    } catch (error) {
      showError(error);
    }
  });


  commands.register("gitnexus.openDiff", async (uri: vscode.Uri) => {
    try {
      const root = await resolveWorkspacePath();
      if (!root || !uri) return;
      await scmDiff.openDiff(root, path.relative(root, uri.fsPath));
    } catch (error) { showError(error); }
  });

  commands.register("gitnexus.discard", async (uri: vscode.Uri) => {
    try {
      const root = await resolveWorkspacePath();
      if (!root || !uri) return;
      const relative = path.relative(root, uri.fsPath);
      const answer = await vscode.window.showWarningMessage(`Discard changes in ${relative}?`, { modal: true }, "Discard");
      if (answer !== "Discard") return;
      await mutation.run({ rootUri: root, operation: "reset", args: ["restore", "--", relative] });
      await repositories.refresh(root);
    } catch (error) { showError(error); }
  });

  commands.register("gitnexus.commit", async () => {
    try {
      const root = await resolveWorkspacePath();
      if (!root) return;
      const message = await vscode.window.showInputBox({ prompt: "Commit message", value: "" });
      if (!message?.trim()) return;
      await mutation.run({ rootUri: root, operation: "commit", args: ["commit", "-m", message.trim()] });
      await repositories.refresh(root);
      vscode.window.showInformationMessage("GitNexus: commit created.");
    } catch (error) { showError(error); }
  });

  commands.register("gitnexus.stage", async (uri: vscode.Uri) => {
    try { const root = await resolveWorkspacePath(); if (!root || !uri) return; await mutation.run({rootUri: root, operation: "stage", args: ["add", "--", path.relative(root, uri.fsPath)]}); await repositories.refresh(root); } catch (error) { showError(error); }
  });

  commands.register("gitnexus.unstage", async (uri: vscode.Uri) => {
    try { const root = await resolveWorkspacePath(); if (!root || !uri) return; await mutation.run({rootUri: root, operation: "stage", args: ["restore", "--staged", "--", path.relative(root, uri.fsPath)]}); await repositories.refresh(root); } catch (error) { showError(error); }
  });

  commands.register("gitnexus.branchList", async () => {
    try { const root = await resolveWorkspacePath(); if (!root) return; const list = await branches.list(root); const pick = await vscode.window.showQuickPick(list.map(b => ({label:b.name, description:b.current?"current":`${b.ahead} ahead · ${b.behind} behind`, detail:b.upstream})), {placeHolder:"Select a branch"}); if (pick && !list.find(b=>b.name===pick.label)?.current) { await mutation.run({rootUri:root, operation:"checkout", args:["switch", pick.label]}); await repositories.refresh(root); } } catch (error) { showError(error); }
  });

  commands.register("gitnexus.branchCreate", async () => {
    try { const root=await resolveWorkspacePath(); if(!root)return; const name=await vscode.window.showInputBox({prompt:"New branch name"}); if(!name)return; await mutation.run({rootUri:root,operation:"branch",args:["switch","-c",name]}); await repositories.refresh(root); } catch(error){showError(error);}
  });

  commands.register("gitnexus.branchDelete", async () => {
    try {
      const root = await resolveWorkspacePath(); if (!root) return;
      const list = await branches.list(root);
      const candidates = list.filter(b => !b.current);
      const pick = await vscode.window.showQuickPick(candidates.map(b => ({ label: b.name, description: `${b.ahead} ahead · ${b.behind} behind` })), { placeHolder: "Select branch to delete" });
      if (!pick) return;
      const confirm = await vscode.window.showWarningMessage(`Delete branch ${pick.label}?`, { modal: true }, "Delete");
      if (confirm !== "Delete") return;
      await mutation.run({ rootUri: root, operation: "branch", args: ["branch", "-d", pick.label] });
      await repositories.refresh(root);
    } catch (error) { showError(error); }
  });

  commands.register("gitnexus.branchRename", async () => {
    try {
      const root = await resolveWorkspacePath(); if (!root) return;
      const current = (await branches.list(root)).find(b => b.current);
      if (!current) return;
      const name = await vscode.window.showInputBox({ prompt: "New branch name", value: current.name });
      if (!name || name === current.name) return;
      await mutation.run({ rootUri: root, operation: "branch", args: ["branch", "-m", name] });
      await repositories.refresh(root);
    } catch (error) { showError(error); }
  });

  commands.register("gitnexus.stashPush", async () => {
    try {
      const root = await resolveWorkspacePath(); if (!root) return;
      const message = await vscode.window.showInputBox({ prompt: "Stash message (optional)" });
      await mutation.run({ rootUri: root, operation: "stash", args: ["stash", "push", ...(message?.trim() ? ["-m", message.trim()] : [])] });
      await repositories.refresh(root);
    } catch (error) { showError(error); }
  });

  commands.register("gitnexus.stashList", async () => {
    try {
      const root = await resolveWorkspacePath(); if (!root) return;
      const list = await stash.list(root);
      const pick = await vscode.window.showQuickPick(list.map(s => ({ label: s.ref, description: s.subject, index: s.index })), { placeHolder: "Select a stash" });
      if (!pick) return;
      const action = await vscode.window.showQuickPick(["Apply", "Pop", "Drop"], { placeHolder: `Action for ${pick.label}` });
      if (!action) return;
      const flag = action === "Apply" ? "apply" : action === "Pop" ? "pop" : "drop";
      await mutation.run({ rootUri: root, operation: "stash", args: ["stash", flag, `stash@{${pick.index}}`] });
      await repositories.refresh(root);
    } catch (error) { showError(error); }
  });

  commands.register("gitnexus.openConflicts", async () => {
    try {
      const root = await resolveWorkspacePath(); if (!root) return;
      await ConflictPanel.open(root, conflicts);
    } catch (error) { showError(error); }
  });

  commands.register("gitnexus.rebasePlan", async () => {
    try { const root=await resolveWorkspacePath(); if(!root)return; const upstream=await vscode.window.showInputBox({prompt:"Rebase upstream",value:"HEAD~5"}); if(!upstream)return; const todos=await rebasePlanner.commits(root,upstream); if(!todos.length){vscode.window.showInformationMessage("GitNexus: no commits to rebase.");return;} const picks=await vscode.window.showQuickPick(todos.map((t,i)=>({label:`${i+1}. ${t.subject}`,description:t.commit.slice(0,10),picked:true})),{canPickMany:true,placeHolder:"Select commits to keep (unselected commits become drop)"}); if(!picks)return; const selected=new Set(picks.map((x: { description?: string })=>x.description)); const plan=todos.map(t=>({...t,action:(selected.has(t.commit.slice(0,10))?"pick":"drop") as any})); await rebasePlanner.execute(root,{upstream,todo:plan}); await repositories.refresh(root); } catch(error){showError(error);}
  });

  commands.register("gitnexus.rebaseStart", async () => {
    try {
      const root = await resolveWorkspacePath();
      if (!root) return;
      const upstream = await vscode.window.showInputBox({
        prompt: "Rebase onto upstream",
        value: "HEAD~5"
      });
      if (!upstream) return;
      await mutation.run({
        rootUri: root,
        operation: "rebase",
        args: ["rebase", "-i", upstream]
      });
      vscode.window.showInformationMessage("GitNexus: interactive rebase completed.");
    } catch (error) {
      showError(error);
    }
  });

  commands.register("gitnexus.rebaseStatus", async () => {
    try {
      const root = await resolveWorkspacePath();
      if (!root) return;
      const state = mutation.getState(root);
      const detected = state ?? await detector.detect(root);
      vscode.window.showInformationMessage(
        `GitNexus: ${detected.phase}${detected.conflictPaths.length ? ` — ${detected.conflictPaths.join(", ")}` : ""}`
      );
    } catch (error) { showError(error); }
  });

  commands.register("gitnexus.rebaseContinue", async () => {
    try {
      const root = await resolveWorkspacePath();
      if (!root) return;
      await rebase.action(root, "continue");
      vscode.window.showInformationMessage("GitNexus: rebase continued.");
    } catch (error) { showError(error); }
  });

  commands.register("gitnexus.rebaseAbort", async () => {
    try {
      const root = await resolveWorkspacePath();
      if (!root) return;
      await rebase.action(root, "abort");
      vscode.window.showInformationMessage("GitNexus: rebase aborted.");
    } catch (error) { showError(error); }
  });

  commands.register("gitnexus.listWorktrees", async () => {
    try {
      const root = await resolveWorkspacePath();
      if (!root) return;
      const items = await worktrees.list(root);
      const text = items.map(w =>
        `${w.path}\t${w.branch ?? "(detached)"}\t${w.head?.slice(0, 8) ?? ""}`
      ).join("\n");
      const document = await vscode.workspace.openTextDocument({
        language: "text",
        content: text || "No worktrees."
      });
      await vscode.window.showTextDocument(document, { preview: false });
    } catch (error) { showError(error); }
  });

  commands.register("gitnexus.showCommit", async (commitId: string) => {
    try {
      const root = await resolveWorkspacePath();
      if (!root) return;
      const details = await commitDetails.get(root, commitId);
      const document = await vscode.workspace.openTextDocument({
        language: "diff",
        content: details.diff || `${details.commit.subject}\n`
      });
      await vscode.window.showTextDocument(document, { preview: false });
    } catch (error) {
      showError(error);
    }
  });

  commands.register("gitnexus.fileHistory", async () => {
    try {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const root = vscode.workspace.getWorkspaceFolder(editor.document.uri)?.uri.fsPath;
      if (!root) return;
      const history = await fileHistory.history(root, editor.document.uri.fsPath, 100);
      const lines = history.map(c => `${c.id.slice(0, 8)}  ${c.authorName}  ${c.subject}`);
      const document = await vscode.workspace.openTextDocument({
        language: "text",
        content: lines.join("\n")
      });
      await vscode.window.showTextDocument(document, { preview: false });
    } catch (error) {
      showError(error);
    }
  });

  commands.register("gitnexus.compare", async () => {
    try {
      const root = await resolveWorkspacePath();
      if (!root) return;
      const base = await vscode.window.showInputBox({ prompt: "Base ref", value: "HEAD~1" });
      if (!base) return;
      const target = await vscode.window.showInputBox({ prompt: "Target ref", value: "HEAD" });
      if (!target) return;
      const result = await compare.compare(root, base, target);
      const document = await vscode.workspace.openTextDocument({
        language: "diff",
        content: result.patch
      });
      await vscode.window.showTextDocument(document, { preview: false });
    } catch (error) {
      showError(error);
    }
  });

  const blameProvider = new BlameCodeLensProvider(blame);
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider({ scheme: "file" }, blameProvider),
    { dispose: () => blameProvider.dispose() }
  );

for (const folder of vscode.workspace.workspaceFolders ?? []) {
  const scm = new GitNexusScmProvider(folder.uri, store, executor);
  scmProviders.push(scm);
  context.subscriptions.push(scm);
  context.subscriptions.push(new ScmWatcher(folder.uri, repositories));
  repositories.refresh(folder.uri.fsPath).catch(() => undefined);
}

context.subscriptions.push({ dispose: () => commands.dispose() });
}

async function resolveWorkspacePath(): Promise<string | undefined> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) {
    vscode.window.showWarningMessage("GitNexus: open a Git repository or workspace first.");
    return undefined;
  }
  if (folders.length === 1) return folders[0].uri.fsPath;
  const picked = await vscode.window.showWorkspaceFolderPick({
    placeHolder: "Select a workspace for GitNexus"
  });
  return picked?.uri.fsPath;
}

function showError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  vscode.window.showErrorMessage(`GitNexus: ${message}`);
}

export function deactivate(): void {}
