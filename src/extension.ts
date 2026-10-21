import * as vscode from "vscode";
import * as path from "node:path";
import { NodeGitProcessExecutor } from "./git/processExecutor";
import { NodeGitBackend } from "./git/backend";
import { InMemoryOperationLog } from "./git/operationLog";
import { GitService } from "./git/gitService";
import { RepositoryStateStore } from "./state/repositoryStateStore";
import { RepositoryManager } from "./app/repositoryManager";
import { CommandRegistry } from "./app/commandRegistry";
import { GraphService } from "./features/graph/graphService";
import { InteractiveGraphPanel } from "./features/graph/graphPanel";
import { CommitDetailsService } from "./features/commit/commitDetailsService";
import { BlameService } from "./features/blame/blameService";
import { BlameCodeLensProvider } from "./features/blame/blameCodeLens";
import { BlameCache } from "./features/blame/blameCache";
import { CurrentLineBlameController } from "./features/blame/currentLineBlame";
import { BlameGutterController } from "./features/blame/blameGutter";
import { BlameHoverProvider } from "./features/blame/blameHover";
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
import { RepositoryEventBus } from "./state/eventBus";
import { OperationJournal, OperationJournalEntry } from "./state/operationJournal";
import { GitNexusScmProvider } from "./features/scm/scmProvider";
import { BranchService } from "./features/branch/branchService";
import { RebasePlanner } from "./features/rebase/rebasePlanner";
import { ScmDiffService } from "./features/scm/scmDiffService";
import { ScmWatcher } from "./features/scm/scmWatcher";
import { StashService } from "./features/stash/stashService";
import { ConflictService } from "./features/conflicts/conflictService";
import { ConflictPanel } from "./features/conflicts/conflictPanel";
import { STAGE_SCHEME, StageDocumentProvider } from "./features/conflicts/stageDocumentProvider";
import { OperationService } from "./git/operationService";
import { TagService } from "./git/tagService";
import { WorktreePanel, WorktreeTreeItem } from "./features/worktree/worktreePanel";
import { RebasePlannerPanel } from "./features/rebase/rebasePlannerPanel";
import { RemoteService } from "./git/remoteService";
import { GitHubPullRequestProvider } from "./features/pr/githubProvider";
import { parseGitHubRemote } from "./features/pr/remoteInfo";
import { buildPrDecorations } from "./features/pr/prDecorations";
import { PullRequestProvider } from "./domain/pr";
import { AiContextStore, buildAiContextPackage } from "./features/ai/aiContext";

export function activate(context: vscode.ExtensionContext): void {
  const config = vscode.workspace.getConfiguration("gitnexus");
  const gitPath = config.get<string>("gitPath", "git");
  const timeoutMs = config.get<number>("gitTimeoutMs", 30000);

  const operationLog = new InMemoryOperationLog();
  const executor = new NodeGitProcessExecutor(gitPath, operationLog);
  const backend = new NodeGitBackend(gitPath, operationLog);
  const git = new GitService(executor, timeoutMs, backend);
  const store = new RepositoryStateStore();
  const bus = new RepositoryEventBus();
  let journal: OperationJournal;
  journal = new OperationJournal(
    () => { void context.globalState.update("gitnexus.operationJournal", journal.serialize()); },
    context.globalState.get<OperationJournalEntry[]>("gitnexus.operationJournal", [])
  );
  const interruptedOps = journal.interrupted();
  if (interruptedOps.length) {
    // Crash recovery (State Model §31): report, never auto-continue.
    void vscode.window.showWarningMessage(
      `GitNexus: ${interruptedOps.length} operation(s) were interrupted by a restart and were not continued automatically: ${interruptedOps.map(e => e.type).join(", ")}. Check the repository state before retrying.`
    );
  }
  const repositories = new RepositoryManager(git, store, { executor, bus });
  const graph = new GraphService(git);
  const commitDetails = new CommitDetailsService(executor, timeoutMs);
  const blame = new BlameService(executor, timeoutMs);
  const fileHistory = new FileHistoryService(executor, timeoutMs);
  const compare = new CompareService(executor, timeoutMs);
  const refs = new RefService(executor, timeoutMs);
  const search = new CommitSearchService(executor, timeoutMs);
  const worktrees = new WorktreeService(executor, timeoutMs);
  const detector = new RepositoryOperationDetector(executor, 10000);
  const mutation = new MutationCoordinator(executor, detector, journal);
  const rebase = new RebaseService(mutation, detector);
  const scmProviders: GitNexusScmProvider[] = [];
  const branches = new BranchService(executor, timeoutMs);
  const rebasePlanner = new RebasePlanner(executor, 120000, mutation);
  const scmDiff = new ScmDiffService(executor, timeoutMs);
  const stash = new StashService(executor, timeoutMs);
  const conflicts = new ConflictService(executor, mutation);
  const operations = new OperationService(executor, detector);
  const tags = new TagService(executor, timeoutMs);
  const remotes = new RemoteService(executor, timeoutMs);
  const aiStore = new AiContextStore();
  const aiStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 90);
  aiStatus.command = "gitnexus.buildAiContext";
  const updateAiStatus = () => {
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const snapshot = folder ? store.get(folder) : undefined;
    const pkg = aiStore.get();
    if (!pkg) {
      aiStatus.text = "$(sparkle) GitNexus AI context: none";
    } else if (snapshot && aiStore.isStale(snapshot.generation)) {
      aiStatus.text = `$(warning) GitNexus AI context stale (gen ${pkg.context.repositoryGeneration} → ${snapshot.generation})`;
    } else {
      aiStatus.text = `$(check) GitNexus AI context · gen ${pkg.context.repositoryGeneration}`;
    }
    aiStatus.show();
  };
  repositories.onEvent(() => updateAiStatus());
  updateAiStatus();
  context.subscriptions.push(aiStatus);

  const makePrProvider = async (root: string, interactive: boolean): Promise<PullRequestProvider | undefined> => {
    const remoteList = await remotes.list(root).catch(() => []);
    const ordered = [...remoteList].sort((a, b) =>
      (a.name === "origin" ? 0 : 1) - (b.name === "origin" ? 0 : 1));
    for (const remote of ordered) {
      const parsed = parseGitHubRemote(remote.fetchUrl ?? remote.pushUrl ?? "");
      if (!parsed) continue;
      return new GitHubPullRequestProvider({
        remote: parsed,
        getToken: async () => {
          const session = await vscode.authentication.getSession("github", ["repo"], { createIfNone: interactive });
          return session?.accessToken;
        }
      });
    }
    return undefined;
  };
  const worktreePanel = new WorktreePanel(worktrees, resolveWorkspacePath);
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(STAGE_SCHEME, new StageDocumentProvider(conflicts)),
    vscode.window.registerTreeDataProvider("gitnexus.worktrees", worktreePanel)
  );
  void worktreePanel.refresh();
  const commands = new CommandRegistry();

  commands.register("gitnexus.openGraph", async () => {
    try {
      const root = await resolveWorkspacePath();
      if (!root) return;
      const data = await graph.build(root, 500);
      const refSnapshot = await refs.list(root);
      const decorations = buildRefDecorations(data, refSnapshot);
      // Layer C: open PRs as decorations, when a GitHub remote + an
      // existing sign-in are available (silent — never prompt from here).
      try {
        const provider = await makePrProvider(root, false);
        if (provider) {
          const prs = await provider.listOpen();
          const byCommit = new Map(decorations.map(d => [d.commitId, d]));
          for (const decoration of buildPrDecorations(prs, refSnapshot)) {
            const existing = byCommit.get(decoration.commitId);
            if (existing) existing.labels.push(...decoration.labels);
            else decorations.push(decoration);
          }
        }
      } catch { /* PR layer is best-effort decoration */ }
      const snapshot = store.get(root);
      const notices = snapshot?.domains?.derived.notices ?? [];
      const notice = notices.includes("shallow-clone")
        ? "History is limited because this repository is shallow."
        : notices.includes("partial-clone")
          ? "Partial clone — missing objects are fetched from the remote on demand."
          : notices.includes("sparse-checkout")
            ? "Sparse checkout — only part of the tree is present in the working copy."
            : undefined;
      InteractiveGraphPanel.open(context, data, decorations, {
        onSelect: async commitId => {
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
        },
        onFetchMore: async () => {
          await vscode.commands.executeCommand("gitnexus.fetchMoreHistory");
        },
        onCommitAction: async (action, commitId) => {
          try {
            if (action === "aiContext") {
              aiStore.addToSelection(commitId);
              updateAiStatus();
              vscode.window.showInformationMessage(
                `GitNexus: ${commitId.slice(0, 10)} added to the AI context selection (${aiStore.selectedCommits().length} selected).`
              );
              return;
            }
            if (action === "copyHash") {
              await vscode.env.clipboard.writeText(commitId);
              vscode.window.showInformationMessage(`GitNexus: copied ${commitId.slice(0, 10)}`);
              return;
            }
            if (action === "checkout") {
              await mutation.run({ rootUri: root, operation: "checkout", args: ["checkout", commitId] });
              vscode.window.showInformationMessage(`GitNexus: checked out ${commitId.slice(0, 10)} (detached HEAD).`);
            } else if (action === "createBranch") {
              const name = await vscode.window.showInputBox({ prompt: "New branch name", placeHolder: "feature/…" });
              if (!name) return;
              await branches.create(root, name, commitId);
              const checkout = await vscode.window.showQuickPick(["Checkout", "Stay"], { placeHolder: "Branch created — check it out?" });
              if (checkout === "Checkout") await branches.checkout(root, name);
            } else if (action === "createTag") {
              const name = await vscode.window.showInputBox({ prompt: "New tag name", placeHolder: "v1.0.0" });
              if (!name) return;
              await tags.create(root, name, commitId);
              vscode.window.showInformationMessage(`GitNexus: tag ${name} created at ${commitId.slice(0, 10)}.`);
            }
            await repositories.refresh(root);
          } catch (error) {
            showError(error);
          }
        }
      }, notice);
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
      const notices = snapshot.domains?.derived.notices ?? [];
      vscode.window.showInformationMessage(
        `${s.isClean ? "Clean" : `${s.entries.length} change(s)`}` +
        ` · ${s.branch ?? "(detached)"}` +
        ` · ahead ${s.ahead}, behind ${s.behind}` +
        (notices.length ? ` · ${notices.join(", ")}` : "")
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
      const detected = await detector.detect(root);
      const label = detected.operation
        ? `${detected.operation} in progress${detected.phase === "conflict" ? " — unresolved conflicts" : ""}`
        : undefined;
      await ConflictPanel.open(root, conflicts, label);
    } catch (error) { showError(error); }
  });

  const runOperationAction = async (action: "continue" | "skip" | "abort") => {
    const root = await resolveWorkspacePath(); if (!root) return;
    const plan = await operations.plan(root, action);
    await mutation.run({
      rootUri: root,
      operation: plan.kind,
      args: plan.args,
      env: plan.env,
      allowDuringConflict: true
    });
    vscode.window.showInformationMessage(`GitNexus: ${plan.kind} ${action === "abort" ? "aborted" : action === "skip" ? "skipped" : "continued"}.`);
    await repositories.refresh(root);
  };

  commands.register("gitnexus.operationContinue", async () => {
    try { await runOperationAction("continue"); } catch (error) { showError(error); }
  });

  commands.register("gitnexus.operationSkip", async () => {
    try { await runOperationAction("skip"); } catch (error) { showError(error); }
  });

  commands.register("gitnexus.operationAbort", async () => {
    try { await runOperationAction("abort"); } catch (error) { showError(error); }
  });

  commands.register("gitnexus.rebaseSkip", async () => {
    try {
      const root = await resolveWorkspacePath(); if (!root) return;
      await rebase.action(root, "skip");
      vscode.window.showInformationMessage("GitNexus: rebase step skipped.");
      await repositories.refresh(root);
    } catch (error) { showError(error); }
  });

  commands.register("gitnexus.rebaseEditTodo", async () => {
    try {
      const root = await resolveWorkspacePath(); if (!root) return;
      const gitPath = async (name: string) => {
        const result = await executor.exec(["rev-parse", "--git-path", name], { cwd: root, timeoutMs: 10000 });
        const value = result.stdout.trim();
        return path.isAbsolute(value) ? value : path.join(root, value);
      };
      let todoFile: string | undefined;
      for (const dir of ["rebase-merge", "rebase-apply"]) {
        const candidate = path.join(await gitPath(dir), "git-rebase-todo");
        try {
          await import("node:fs/promises").then(fs => fs.access(candidate));
          todoFile = candidate;
          break;
        } catch { /* not this dir */ }
      }
      if (!todoFile) {
        vscode.window.showInformationMessage("GitNexus: no rebase in progress — nothing to edit.");
        return;
      }
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(todoFile));
      await vscode.window.showTextDocument(document, { preview: false });
      vscode.window.showInformationMessage("GitNexus: edit and save the todo list, then run Rebase: Continue.");
    } catch (error) { showError(error); }
  });

  commands.register("gitnexus.openRebasePlanner", async () => {
    try {
      const root = await resolveWorkspacePath(); if (!root) return;
      const upstream = await vscode.window.showInputBox({ prompt: "Rebase upstream", value: "HEAD~5" });
      if (!upstream) return;
      const todos = await rebasePlanner.commits(root, upstream);
      if (!todos.length) { vscode.window.showInformationMessage("GitNexus: no commits to rebase."); return; }
      const result = await RebasePlannerPanel.open(todos.map((todo, index) => ({
        id: todo.commit,
        action: todo.action,
        commit: todo.commit,
        subject: todo.subject,
        originalIndex: index
      })));
      if (!result) return;
      const plan = result.todo.split(/\r?\n/).filter(Boolean).map(line => {
        const match = line.match(/^(\w+)\s+([0-9a-f]+)\s*(.*)$/i);
        return match
          ? { action: match[1] as typeof todos[number]["action"], commit: match[2], subject: match[3] ?? "" }
          : undefined;
      }).filter((item): item is NonNullable<typeof item> => Boolean(item));
      await rebasePlanner.execute(root, { upstream, todo: plan });
      await repositories.refresh(root);
    } catch (error) { showError(error); }
  });

  commands.register("gitnexus.graphNextMatch", () => {
    InteractiveGraphPanel.nextMatch();
  });

  commands.register("gitnexus.graphPreviousMatch", () => {
    InteractiveGraphPanel.previousMatch();
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
      await worktreePanel.refresh();
      await vscode.commands.executeCommand("gitnexus.worktrees.focus");
    } catch (error) { showError(error); }
  });

  const worktreeTarget = async (item?: WorktreeTreeItem): Promise<string | undefined> => {
    if (item?.worktree.path) return item.worktree.path;
    const root = await resolveWorkspacePath(); if (!root) return undefined;
    const items = await worktrees.list(root);
    const picked = await vscode.window.showQuickPick(
      items.map(w => ({ label: w.branch ?? "(detached)", description: w.path, path: w.path })),
      { placeHolder: "Select a worktree" }
    );
    return picked?.path;
  };

  const afterWorktreeChange = async (root: string) => {
    await repositories.refresh(root);
    await worktreePanel.refresh();
  };

  commands.register("gitnexus.worktreeAdd", async () => {
    try {
      const root = await resolveWorkspacePath(); if (!root) return;
      const target = await vscode.window.showInputBox({
        prompt: "Path for the new worktree",
        value: `${root}-wt`
      });
      if (!target) return;
      const ref = await vscode.window.showInputBox({
        prompt: "Branch or commit to check out (blank = new branch from HEAD)",
        placeHolder: "main"
      });
      await mutation.run({
        rootUri: root,
        operation: "worktree",
        args: ["worktree", "add", target, ...(ref ? [ref] : [])]
      });
      vscode.window.showInformationMessage(`GitNexus: worktree added at ${target}.`);
      await afterWorktreeChange(root);
    } catch (error) { showError(error); }
  });

  commands.register("gitnexus.worktreeRemove", async (item?: WorktreeTreeItem) => {
    try {
      const root = await resolveWorkspacePath(); if (!root) return;
      const target = await worktreeTarget(item); if (!target) return;
      const confirm = await vscode.window.showWarningMessage(
        `Remove the worktree at ${target}?`, { modal: true }, "Remove"
      );
      if (confirm !== "Remove") return;
      try {
        await mutation.run({ rootUri: root, operation: "worktree", args: ["worktree", "remove", target] });
      } catch {
        const force = await vscode.window.showWarningMessage(
          "Git refused (the worktree has changes). Force remove?", { modal: true }, "Force remove"
        );
        if (force !== "Force remove") return;
        await mutation.run({ rootUri: root, operation: "worktree", args: ["worktree", "remove", "--force", target] });
      }
      vscode.window.showInformationMessage(`GitNexus: worktree removed.`);
      await afterWorktreeChange(root);
    } catch (error) { showError(error); }
  });

  commands.register("gitnexus.worktreeMove", async (item?: WorktreeTreeItem) => {
    try {
      const root = await resolveWorkspacePath(); if (!root) return;
      const target = await worktreeTarget(item); if (!target) return;
      const destination = await vscode.window.showInputBox({ prompt: "New path for the worktree", value: target });
      if (!destination || destination === target) return;
      await mutation.run({ rootUri: root, operation: "worktree", args: ["worktree", "move", target, destination] });
      await afterWorktreeChange(root);
    } catch (error) { showError(error); }
  });

  commands.register("gitnexus.worktreeLock", async (item?: WorktreeTreeItem) => {
    try {
      const root = await resolveWorkspacePath(); if (!root) return;
      const target = await worktreeTarget(item); if (!target) return;
      await mutation.run({ rootUri: root, operation: "worktree", args: ["worktree", "lock", target] });
      await afterWorktreeChange(root);
    } catch (error) { showError(error); }
  });

  commands.register("gitnexus.worktreeUnlock", async (item?: WorktreeTreeItem) => {
    try {
      const root = await resolveWorkspacePath(); if (!root) return;
      const target = await worktreeTarget(item); if (!target) return;
      await mutation.run({ rootUri: root, operation: "worktree", args: ["worktree", "unlock", target] });
      await afterWorktreeChange(root);
    } catch (error) { showError(error); }
  });

  commands.register("gitnexus.worktreePrune", async () => {
    try {
      const root = await resolveWorkspacePath(); if (!root) return;
      await mutation.run({ rootUri: root, operation: "worktree", args: ["worktree", "prune"] });
      vscode.window.showInformationMessage("GitNexus: stale worktree entries pruned.");
      await afterWorktreeChange(root);
    } catch (error) { showError(error); }
  });

  commands.register("gitnexus.worktreeOpen", async (item?: WorktreeTreeItem) => {
    try {
      const target = await worktreeTarget(item); if (!target) return;
      await vscode.commands.executeCommand(
        "vscode.openFolder", vscode.Uri.file(target), { forceNewWindow: true }
      );
    } catch (error) { showError(error); }
  });

  commands.register("gitnexus.fetchMoreHistory", async () => {
    try {
      const root = await resolveWorkspacePath(); if (!root) return;
      const choice = await vscode.window.showQuickPick(
        [
          { label: "Deepen by 100 commits", args: ["fetch", "--deepen=100"] },
          { label: "Fetch full history (unshallow)", args: ["fetch", "--unshallow"] }
        ],
        { placeHolder: "History is limited in this repository — fetch more" }
      );
      if (!choice) return;
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "GitNexus: fetching history…" },
        async () => { await executor.exec(choice.args, { cwd: root, timeoutMs: 300000 }); }
      );
      await repositories.refresh(root);
      vscode.window.showInformationMessage("GitNexus: history fetched.");
    } catch (error) { showError(error); }
  });

  commands.register("gitnexus.prList", async () => {
    try {
      const root = await resolveWorkspacePath(); if (!root) return;
      const provider = await makePrProvider(root, true);
      if (!provider) {
        vscode.window.showInformationMessage("GitNexus: no GitHub remote found for this repository.");
        return;
      }
      const prs = await provider.listOpen();
      if (!prs.length) {
        vscode.window.showInformationMessage(`GitNexus: no open pull requests in ${provider.repositorySlug}.`);
        return;
      }
      const picked = await vscode.window.showQuickPick(
        prs.map(pr => ({
          label: `#${pr.number} ${pr.title}`,
          description: `@${pr.author} · ${pr.headBranch} → ${pr.baseBranch}`,
          url: pr.url
        })),
        { placeHolder: `Open pull requests — ${provider.repositorySlug}` }
      );
      if (picked) await vscode.env.openExternal(vscode.Uri.parse(picked.url));
    } catch (error) { showError(error); }
  });

  commands.register("gitnexus.prStatus", async () => {
    try {
      const root = await resolveWorkspacePath(); if (!root) return;
      const provider = await makePrProvider(root, true);
      if (!provider) {
        vscode.window.showInformationMessage("GitNexus: no GitHub remote found for this repository.");
        return;
      }
      const snapshot = await repositories.refresh(root);
      const branch = snapshot.head.ref;
      if (!branch) {
        vscode.window.showInformationMessage("GitNexus: detached HEAD — no branch to look up a PR for.");
        return;
      }
      const pr = await provider.forBranch(branch);
      if (!pr) {
        vscode.window.showInformationMessage(`GitNexus: no open PR for branch ${branch}.`);
        return;
      }
      const action = await vscode.window.showInformationMessage(
        `PR #${pr.number} ${pr.title} · CI ${pr.ciStatus ?? "unknown"} · review ${pr.reviewStatus ?? "none"}`,
        "Open"
      );
      if (action === "Open") await vscode.env.openExternal(vscode.Uri.parse(pr.url));
    } catch (error) { showError(error); }
  });

  commands.register("gitnexus.prCreate", async () => {
    try {
      const root = await resolveWorkspacePath(); if (!root) return;
      const provider = await makePrProvider(root, false);
      if (!provider) {
        vscode.window.showInformationMessage("GitNexus: no GitHub remote found for this repository.");
        return;
      }
      const snapshot = await repositories.refresh(root);
      const head = snapshot.head.ref;
      if (!head) {
        vscode.window.showInformationMessage("GitNexus: detached HEAD — checkout a branch to open a PR.");
        return;
      }
      const branchNames = (snapshot.domains?.refs.branches ?? [])
        .map(b => b.shortName)
        .filter(name => name !== head);
      const base = await vscode.window.showQuickPick(
        branchNames, { placeHolder: `Base branch for ${head}` }
      );
      if (!base) return;
      await vscode.env.openExternal(vscode.Uri.parse(provider.createUrl(base, head)));
    } catch (error) { showError(error); }
  });

  commands.register("gitnexus.buildAiContext", async () => {
    try {
      const root = await resolveWorkspacePath(); if (!root) return;
      const snapshot = await repositories.refresh(root);
      const selected = aiStore.selectedCommits();
      const scopes = [
        { label: "Working tree changes + recent commits", id: "changes" },
        { label: "Recent history (25 commits)", id: "history" },
        ...(selected.length
          ? [{ label: `Graph selection (${selected.length} commit(s))`, id: "selection" }]
          : [])
      ];
      const scope = await vscode.window.showQuickPick(scopes, { placeHolder: "AI context scope" });
      if (!scope) return;
      const pkg = buildAiContextPackage(snapshot,
        scope.id === "selection" ? { commits: selected }
        : scope.id === "history" ? { recentCommits: 25 }
        : {});
      aiStore.set(pkg);
      updateAiStatus();
      const document = await vscode.workspace.openTextDocument({ language: "markdown", content: pkg.markdown });
      await vscode.window.showTextDocument(document, { preview: false });
    } catch (error) { showError(error); }
  });

  commands.register("gitnexus.copyAiContext", async () => {
    try {
      const root = await resolveWorkspacePath(); if (!root) return;
      const pkg = aiStore.get();
      if (!pkg) {
        await vscode.commands.executeCommand("gitnexus.buildAiContext");
        return;
      }
      const snapshot = store.get(root);
      if (snapshot && aiStore.isStale(snapshot.generation)) {
        const choice = await vscode.window.showWarningMessage(
          `The AI context is pinned to generation ${pkg.context.repositoryGeneration}, but the repository is at generation ${snapshot.generation}.`,
          "Rebuild", "Copy anyway"
        );
        if (choice === "Rebuild") {
          await vscode.commands.executeCommand("gitnexus.buildAiContext");
          return;
        }
        if (choice !== "Copy anyway") return;
      }
      await vscode.env.clipboard.writeText(pkg.markdown);
      vscode.window.showInformationMessage("GitNexus: AI context copied to the clipboard.");
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

  // Editor annotation layer (blame): shared cache + current-line
  // annotation + gutter annotations + commit hover + CodeLens.
  const blameCache = new BlameCache(blame, store);
  const blameProvider = new BlameCodeLensProvider(blameCache);
  const currentLineBlame = new CurrentLineBlameController(blameCache);
  const blameGutter = new BlameGutterController(blameCache, context.workspaceState);
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider({ scheme: "file" }, blameProvider),
    { dispose: () => blameProvider.dispose() },
    vscode.languages.registerHoverProvider({ scheme: "file" }, new BlameHoverProvider(blameCache, blame)),
    currentLineBlame,
    blameGutter,
    {
      dispose: store.onChanged(() => {
        blameProvider.refresh();
        currentLineBlame.refresh();
        blameGutter.refreshAll();
      })
    }
  );
  commands.register("gitnexus.blameToggle", async () => {
    await blameGutter.toggle();
  });
  commands.register("gitnexus.copyHash", async (hash?: string) => {
    if (!hash) return;
    await vscode.env.clipboard.writeText(hash);
    void vscode.window.setStatusBarMessage(`GitNexus: copied ${hash.slice(0, 10)}`, 2000);
  });

for (const folder of vscode.workspace.workspaceFolders ?? []) {
  const scm = new GitNexusScmProvider(folder.uri, store, executor);
  scmProviders.push(scm);
  context.subscriptions.push(scm);
  context.subscriptions.push(new ScmWatcher(folder.uri, repositories, bus));
  repositories.refresh(folder.uri.fsPath).catch(() => undefined);
}

context.subscriptions.push({ dispose: () => commands.dispose() });
context.subscriptions.push({ dispose: () => repositories.dispose() });
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
