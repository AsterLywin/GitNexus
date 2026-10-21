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
import { gravatarUrl } from "./features/graph/avatar";
import { CommitDetailsService } from "./features/commit/commitDetailsService";
import { BlameService } from "./features/blame/blameService";
import { BlameCodeLensProvider } from "./features/blame/blameCodeLens";
import { BlameCache } from "./features/blame/blameCache";
import { CurrentLineBlameController } from "./features/blame/currentLineBlame";
import { BlameGutterController } from "./features/blame/blameGutter";
import { BlameHoverProvider } from "./features/blame/blameHover";
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
import { CommitsViewProvider, CommitTreeItem } from "./features/explorer/commitsView";
import { BranchesViewProvider, BranchTreeItem, TagsViewProvider, TagTreeItem, RemotesViewProvider, RemoteTreeItem } from "./features/explorer/refsViews";
import { StashesViewProvider, StashTreeItem, ContributorsViewProvider } from "./features/explorer/stashContributorsViews";
import { CompareFileItem, SearchCompareViewProvider } from "./features/explorer/searchCompareView";
import { resolveBlameTarget } from "./features/blame/blameCache";
import { DiffService } from "./features/diff/diffService";
import { buildCommitMessagePrompt, buildExplainCommitPrompt } from "./features/ai/prompts";
import { askModel, pickChatModel } from "./features/ai/lmChat";
import { askByok, GEMINI_KEY_SECRET, OPENAI_KEY_SECRET } from "./features/ai/byok";
import { RebasePlannerPanel } from "./features/rebase/rebasePlannerPanel";
import { RemoteService } from "./git/remoteService";
import { GitHubPullRequestProvider } from "./features/pr/githubProvider";
import { commitWebUrl, parseBitbucketRemote, parseGitHubRemote, parseGitLabRemote } from "./features/pr/remoteInfo";
import { LaunchpadPanel } from "./features/launchpad/launchpadPanel";
import { GitNexusSettingsPanel } from "./features/settings/settingsPanel";
import { LaunchpadItem, prCheckoutRefspec, slugifyIssueBranch, sortLaunchpadItems } from "./features/launchpad/launchpadModel";
import { GitLabPullRequestProvider } from "./features/pr/gitlabProvider";
import { BitbucketPullRequestProvider } from "./features/pr/bitbucketProvider";
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
    const gitlabHosts = vscode.workspace.getConfiguration("gitnexus").get<string[]>("pr.gitlabHosts", []);
    const gheHosts = vscode.workspace.getConfiguration("gitnexus").get<string[]>("pr.githubEnterpriseHosts", []);
    for (const remote of ordered) {
      const url = remote.fetchUrl ?? remote.pushUrl ?? "";

      const github = parseGitHubRemote(url, gheHosts);
      if (github) {
        return new GitHubPullRequestProvider({
          remote: github,
          getToken: async () => {
            const session = await vscode.authentication.getSession("github", ["repo"], { createIfNone: interactive });
            return session?.accessToken;
          }
        });
      }

      const gitlab = parseGitLabRemote(url, gitlabHosts);
      if (gitlab) {
        return new GitLabPullRequestProvider({
          remote: gitlab,
          getToken: async () => {
            // The GitLab Workflow extension provides a "gitlab" auth
            // provider when installed; otherwise our SecretStorage token.
            let session: vscode.AuthenticationSession | undefined;
            try {
              session = await vscode.authentication.getSession("gitlab", ["api"], { createIfNone: false });
            } catch {
              session = undefined;
            }
            if (session?.accessToken) return session.accessToken;
            return context.secrets.get(`gitnexus.gitlabToken.${gitlab.host}`);
          }
        });
      }

      const bitbucket = parseBitbucketRemote(url);
      if (bitbucket) {
        return new BitbucketPullRequestProvider({
          remote: bitbucket,
          getAuthHeader: async () => {
            const raw = await context.secrets.get("gitnexus.bitbucketCredentials");
            if (!raw) return undefined;
            try {
              const parsed = JSON.parse(raw) as { username?: string; password?: string };
              if (!parsed.username || !parsed.password) return undefined;
              return `Basic ${Buffer.from(`${parsed.username}:${parsed.password}`).toString("base64")}`;
            } catch {
              return undefined;
            }
          }
        });
      }
    }
    return undefined;
  };
  const worktreePanel = new WorktreePanel(worktrees, resolveWorkspacePath);
  // Sidebar views (Phase 7): all render the current snapshot via the store.
  const commitsView = new CommitsViewProvider(store, resolveWorkspacePath);
  const branchesView = new BranchesViewProvider(store, resolveWorkspacePath);
  const tagsView = new TagsViewProvider(store, resolveWorkspacePath);
  const remotesView = new RemotesViewProvider(store, resolveWorkspacePath);
  const stashesView = new StashesViewProvider(store, resolveWorkspacePath);
  const contributorsView = new ContributorsViewProvider(store, resolveWorkspacePath, git);
  const searchCompareView = new SearchCompareViewProvider();
  const diffs = new DiffService(executor, timeoutMs);
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(STAGE_SCHEME, new StageDocumentProvider(conflicts)),
    vscode.window.registerTreeDataProvider("gitnexus.worktrees", worktreePanel),
    vscode.window.registerTreeDataProvider("gitnexus.commits", commitsView),
    vscode.window.registerTreeDataProvider("gitnexus.branches", branchesView),
    vscode.window.registerTreeDataProvider("gitnexus.tags", tagsView),
    vscode.window.registerTreeDataProvider("gitnexus.remotes", remotesView),
    vscode.window.registerTreeDataProvider("gitnexus.stashes", stashesView),
    vscode.window.registerTreeDataProvider("gitnexus.contributors", contributorsView),
    vscode.window.registerTreeDataProvider("gitnexus.searchCompare", searchCompareView),
    commitsView, branchesView, tagsView, remotesView, stashesView, contributorsView,
    searchCompareView
  );
  void worktreePanel.refresh();
  const commands = new CommandRegistry();

  const repoOptionsFor = (currentRoot: string): Array<{ root: string; name: string }> => {
    const nameOf = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() ?? p;
    const options = store.all().map(s => ({ root: s.identity.rootUri, name: nameOf(s.identity.rootUri) }));
    if (!options.some(o => o.root === currentRoot)) {
      options.unshift({ root: currentRoot, name: nameOf(currentRoot) });
    }
    return options;
  };

  const graphBranchModes = new Map<string, string>();

  const openGraphForRoot = async (root: string): Promise<void> => {
    const branchMode = graphBranchModes.get(root) ?? "all";
    try {
      const data = await graph.build(root, 500, { allRefs: branchMode === "all" });
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
            let files: Array<{ status: string; path: string }> = [];
            try {
              files = await diffs.nameStatus(root, [`${commitId}^!`]);
            } catch {
              files = details.files.map(path => ({ status: "•", path }));
            }
            InteractiveGraphPanel.showDetails({
              id: details.commit.id,
              subject: details.commit.subject,
              body: details.commit.body,
              authorName: details.commit.authorName,
              authorEmail: details.commit.authorEmail,
              avatarUrl: gravatarUrl(details.commit.authorEmail, 64),
              dateIso: details.commit.authorTimestamp > 0
                ? new Date(details.commit.authorTimestamp * 1000).toISOString().slice(0, 16).replace("T", " ")
                : "",
              parents: details.commit.parents,
              files
            });
          } catch (error) {
            showError(error);
          }
        },
        onFetchMore: async () => {
          await vscode.commands.executeCommand("gitnexus.fetchMoreHistory");
        },
        onCommitAction: async (action, commitId) => {
          try {
            if (action === "showDiff") {
              const details = await commitDetails.get(root, commitId);
              const document = await vscode.workspace.openTextDocument({
                language: "diff",
                content: details.diff || `Commit ${details.commit.id}\n\n${details.commit.subject}\n`
              });
              await vscode.window.showTextDocument(document, { preview: false });
              return;
            }
            if (action === "openRemote") {
              const snapshotForRemote = store.get(root);
              const remotes = snapshotForRemote?.domains?.remotes ?? [];
              const ordered = [...remotes].sort((a, b) => (a.name === "origin" ? 0 : 1) - (b.name === "origin" ? 0 : 1));
              const gheHosts = vscode.workspace.getConfiguration("gitnexus").get<string[]>("pr.githubEnterpriseHosts", []);
              for (const remote of ordered) {
                const url = commitWebUrl(remote.fetchUrl ?? remote.pushUrl ?? "", commitId, gheHosts);
                if (url) { await vscode.env.openExternal(vscode.Uri.parse(url)); return; }
              }
              void vscode.window.showInformationMessage("GitNexus: no GitHub, GitLab or Bitbucket remote to open this commit on.");
              return;
            }
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
        },
        onSwitchRepo: nextRoot => { void openGraphForRoot(nextRoot); },
        onBranchFilter: mode => {
          graphBranchModes.set(root, mode);
          void openGraphForRoot(root);
        },
        onOpenSettings: () => { void vscode.commands.executeCommand("gitnexus.openSettings"); }
      }, notice, repoOptionsFor(root), root, branchMode);
    } catch (error) {
      showError(error);
    }
  };

  commands.register("gitnexus.openGraph", async () => {
    const root = await resolveWorkspacePath();
    if (root) await openGraphForRoot(root);
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

  commands.register("gitnexus.revealInGraph", async (item?: CommitTreeItem | string) => {
    try {
      let commitId: string | undefined;
      if (typeof item === "string") commitId = item;
      else if (item instanceof CommitTreeItem) commitId = item.commit.id;
      if (!commitId) {
        const root = await resolveWorkspacePath(); if (!root) return;
        commitId = store.get(root)?.commits[0]?.id;
        if (!commitId) { void vscode.window.showInformationMessage("GitNexus: no commit to reveal."); return; }
      }
      if (InteractiveGraphPanel.reveal(commitId)) return;
      await vscode.commands.executeCommand("gitnexus.openGraph");
      if (!InteractiveGraphPanel.reveal(commitId)) {
        void vscode.window.showInformationMessage("GitNexus: that commit is beyond the loaded graph history (500 commits).");
      }
    } catch (error) { showError(error); }
  });

  commands.register("gitnexus.fileHistory", async (uri?: vscode.Uri) => {
    try {
      const target = uri ?? vscode.window.activeTextEditor?.document.uri;
      if (!target || target.scheme !== "file") {
        void vscode.window.showInformationMessage("GitNexus: open a file to see its history.");
        return;
      }
      const resolved = resolveBlameTarget(store, target.fsPath);
      if (!resolved) {
        void vscode.window.showInformationMessage("GitNexus: that file is not inside a known repository.");
        return;
      }
      const commits = await git.log(resolved.root, 200, { path: resolved.relativePath, follow: true });
      searchCompareView.setSearch(resolved.root, `file: ${resolved.relativePath}`, commits);
      await vscode.commands.executeCommand("gitnexus.searchCompare.focus");
    } catch (error) { showError(error); }
  });

  commands.register("gitnexus.stashShowItem", async (item?: StashTreeItem) => {
    try {
      if (!item) return;
      const patch = await stash.show(item.root, item.entry.ref);
      const document = await vscode.workspace.openTextDocument({
        language: "diff",
        content: patch || `(${item.entry.ref} has no file changes)`
      });
      await vscode.window.showTextDocument(document, { preview: false });
    } catch (error) { showError(error); }
  });

  commands.register("gitnexus.compareFileDiff", async (item?: CompareFileItem) => {
    try {
      if (!item) return;
      const result = await diffs.diff(item.root, [`${item.base}...${item.target}`, "--", item.file.path]);
      const document = await vscode.workspace.openTextDocument({
        language: "diff",
        content: result.rawPatch || `No changes to ${item.file.path} between ${item.base} and ${item.target}.`
      });
      await vscode.window.showTextDocument(document, { preview: false });
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
        vscode.window.showInformationMessage("GitNexus: no GitHub, GitLab or Bitbucket remote found for this repository.");
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

  commands.register("gitnexus.openSettings", () => {
    GitNexusSettingsPanel.open(context);
  });

  commands.register("gitnexus.openLaunchpad", async () => {
    try {
      LaunchpadPanel.open(context, {
        onCollect: async () => {
          const items: LaunchpadItem[] = [];
          for (const snapshot of store.all()) {
            const root = snapshot.identity.rootUri;
            const provider = await makePrProvider(root, false).catch(() => undefined);
            if (!provider) continue;
            const [prs, issues] = await Promise.all([
              provider.listOpen().catch(() => []),
              provider.listIssues ? provider.listIssues().catch(() => []) : Promise.resolve([])
            ]);
            for (const pr of prs) {
              items.push({
                kind: "pr", providerId: provider.id, providerName: provider.displayName,
                repoSlug: provider.repositorySlug, root, number: pr.number, title: pr.title,
                author: pr.author, url: pr.url, headBranch: pr.headBranch,
                baseBranch: pr.baseBranch, fork: pr.fork
              });
            }
            for (const issue of issues) {
              items.push({
                kind: "issue", providerId: provider.id, providerName: provider.displayName,
                repoSlug: provider.repositorySlug, root, number: issue.number, title: issue.title,
                author: issue.author, url: issue.url, labels: issue.labels
              });
            }
          }
          return sortLaunchpadItems(items);
        },
        onOpenUrl: url => { void vscode.env.openExternal(vscode.Uri.parse(url)); },
        onCheckout: async item => {
          try {
            const refspec = prCheckoutRefspec(item.providerId, {
              number: item.number, headBranch: item.headBranch ?? ""
            });
            await vscode.window.withProgress(
              { location: vscode.ProgressLocation.Notification, title: `GitNexus: fetching PR #${item.number}…` },
              async () => { await executor.exec(["fetch", "origin", refspec], { cwd: item.root, timeoutMs: 120000 }); }
            );
            await branches.checkout(item.root, `pr-${item.number}`);
            await repositories.refresh(item.root);
            void vscode.window.showInformationMessage(`GitNexus: checked out PR #${item.number} as branch pr-${item.number}.`);
          } catch (error) { showError(error); }
        },
        onBranchFromIssue: async item => {
          try {
            const name = slugifyIssueBranch(item.number, item.title);
            await branches.create(item.root, name);
            await branches.checkout(item.root, name);
            await repositories.refresh(item.root);
            void vscode.window.showInformationMessage(`GitNexus: started branch ${name} for issue #${item.number}.`);
          } catch (error) { showError(error); }
        }
      });
    } catch (error) { showError(error); }
  });

  commands.register("gitnexus.suggestChanges", async () => {
    try {
      const root = await resolveWorkspacePath(); if (!root) return;
      const snapshot = store.get(root);
      const branch = snapshot?.status.branch;
      if (!branch) { void vscode.window.showInformationMessage("GitNexus: check out a branch with an open PR first."); return; }
      if (!snapshot || snapshot.status.entries.length === 0) {
        void vscode.window.showInformationMessage("GitNexus: no local changes to suggest.");
        return;
      }
      const provider = await makePrProvider(root, false);
      if (!provider) { void vscode.window.showInformationMessage("GitNexus: no supported remote for this repository."); return; }
      const pr = await provider.forBranch(branch);
      if (!pr) { void vscode.window.showInformationMessage(`GitNexus: no open PR for ${branch}.`); return; }
      if (pr.fork) { void vscode.window.showInformationMessage("GitNexus: fork PRs cannot receive direct suggestion pushes."); return; }
      const confirm = await vscode.window.showWarningMessage(
        `Push your current changes to PR #${pr.number} “${pr.title}” as a suggestion commit?`,
        { modal: true }, "Suggest Changes"
      );
      if (confirm !== "Suggest Changes") return;
      const message = await vscode.window.showInputBox({
        prompt: "Suggestion commit message",
        value: `Suggestion for #${pr.number}`
      });
      if (!message?.trim()) return;
      await mutation.run({ rootUri: root, operation: "stage", args: ["add", "-A"] });
      await mutation.run({ rootUri: root, operation: "commit", args: ["commit", "-m", message.trim()] });
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `GitNexus: pushing suggestion to PR #${pr.number}…` },
        async () => { await executor.exec(["push", "origin", branch], { cwd: root, timeoutMs: 120000 }); }
      );
      await repositories.refresh(root);
      const open = await vscode.window.showInformationMessage(
        `GitNexus: suggestion pushed to PR #${pr.number}.`, "Open PR"
      );
      if (open === "Open PR") await vscode.env.openExternal(vscode.Uri.parse(pr.url));
    } catch (error) { showError(error); }
  });

  commands.register("gitnexus.openCommitOnRemote", async (item?: CommitTreeItem) => {
    try {
      if (!item) return;
      const snapshot = store.get(item.root);
      const remotes = snapshot?.domains?.remotes ?? [];
      const ordered = [...remotes].sort((a, b) => (a.name === "origin" ? 0 : 1) - (b.name === "origin" ? 0 : 1));
      const gheHosts = vscode.workspace.getConfiguration("gitnexus").get<string[]>("pr.githubEnterpriseHosts", []);
      for (const remote of ordered) {
        const url = commitWebUrl(remote.fetchUrl ?? remote.pushUrl ?? "", item.commit.id, gheHosts);
        if (url) { await vscode.env.openExternal(vscode.Uri.parse(url)); return; }
      }
      void vscode.window.showInformationMessage("GitNexus: no GitHub, GitLab or Bitbucket remote to open this commit on.");
    } catch (error) { showError(error); }
  });

  commands.register("gitnexus.setGitLabToken", async () => {
    try {
      const host = await vscode.window.showInputBox({
        prompt: "GitLab host",
        value: "gitlab.com",
        placeHolder: "gitlab.com (or your self-hosted host)"
      });
      if (!host?.trim()) return;
      const token = await vscode.window.showInputBox({
        prompt: `Personal access token for ${host.trim()} (api scope)`,
        password: true
      });
      if (!token) return;
      await context.secrets.store(`gitnexus.gitlabToken.${host.trim()}`, token);
      void vscode.window.showInformationMessage(`GitNexus: GitLab token saved for ${host.trim()}.`);
    } catch (error) { showError(error); }
  });

  commands.register("gitnexus.setBitbucketCredentials", async () => {
    try {
      const username = await vscode.window.showInputBox({ prompt: "Bitbucket username" });
      if (!username?.trim()) return;
      const password = await vscode.window.showInputBox({
        prompt: "Bitbucket app password",
        password: true
      });
      if (!password) return;
      await context.secrets.store("gitnexus.bitbucketCredentials",
        JSON.stringify({ username: username.trim(), password }));
      void vscode.window.showInformationMessage("GitNexus: Bitbucket credentials saved.");
    } catch (error) { showError(error); }
  });

  commands.register("gitnexus.prStatus", async () => {
    try {
      const root = await resolveWorkspacePath(); if (!root) return;
      const provider = await makePrProvider(root, true);
      if (!provider) {
        vscode.window.showInformationMessage("GitNexus: no GitHub, GitLab or Bitbucket remote found for this repository.");
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

  /* ------------------------- sidebar view actions ------------------------- */

  commands.register("gitnexus.viewsRefresh", async () => {
    try {
      const root = await resolveWorkspacePath();
      if (root) await repositories.refresh(root);
    } catch (error) { showError(error); }
  });

  commands.register("gitnexus.copyHashFor", async (item?: { commit?: { id: string }; ref?: { objectId: string } }) => {
    const hash = item?.commit?.id ?? item?.ref?.objectId;
    if (!hash) return;
    await vscode.env.clipboard.writeText(hash);
    void vscode.window.setStatusBarMessage(`GitNexus: copied ${hash.slice(0, 10)}`, 2000);
  });

  commands.register("gitnexus.checkoutRef", async (item?: BranchTreeItem | TagTreeItem | CommitTreeItem) => {
    try {
      if (!item) return;
      let args: string[] | undefined;
      if (item instanceof CommitTreeItem) {
        args = ["switch", "--detach", item.commit.id];
      } else if (item instanceof TagTreeItem) {
        args = ["switch", "--detach", item.ref.shortName];
      } else if (item instanceof BranchTreeItem) {
        args = item.ref.kind === "remoteBranch"
          ? ["switch", item.ref.shortName.slice(item.ref.shortName.indexOf("/") + 1)]
          : ["switch", item.ref.shortName];
      }
      if (!args) return;
      await mutation.run({ rootUri: item.root, operation: "checkout", args });
      await repositories.refresh(item.root);
    } catch (error) { showError(error); }
  });

  commands.register("gitnexus.createBranchFrom", async (item?: BranchTreeItem | TagTreeItem | CommitTreeItem) => {
    try {
      if (!item) return;
      const startPoint = item instanceof CommitTreeItem ? item.commit.id : item.ref.name;
      const name = await vscode.window.showInputBox({ prompt: `New branch at ${startPoint.slice(0, 24)}`, placeHolder: "branch-name" });
      if (!name?.trim()) return;
      await mutation.run({ rootUri: item.root, operation: "branch", args: ["branch", name.trim(), startPoint] });
      await repositories.refresh(item.root);
    } catch (error) { showError(error); }
  });

  commands.register("gitnexus.deleteBranchItem", async (item?: BranchTreeItem) => {
    try {
      if (!item || item.ref.isCurrent) return;
      const confirm = await vscode.window.showWarningMessage(`Delete branch ${item.ref.shortName}?`, { modal: true }, "Delete");
      if (confirm !== "Delete") return;
      await mutation.run({ rootUri: item.root, operation: "branch", args: ["branch", "-d", item.ref.shortName] });
      await repositories.refresh(item.root);
    } catch (error) { showError(error); }
  });

  commands.register("gitnexus.deleteTagItem", async (item?: TagTreeItem) => {
    try {
      if (!item) return;
      const confirm = await vscode.window.showWarningMessage(`Delete tag ${item.ref.shortName}?`, { modal: true }, "Delete");
      if (confirm !== "Delete") return;
      await tags.delete(item.root, item.ref.shortName);
      await repositories.refresh(item.root);
    } catch (error) { showError(error); }
  });

  commands.register("gitnexus.tagCreate", async () => {
    try {
      const root = await resolveWorkspacePath(); if (!root) return;
      const name = await vscode.window.showInputBox({ prompt: "Tag name" });
      if (!name?.trim()) return;
      const message = await vscode.window.showInputBox({ prompt: "Tag message (optional — annotated tag)" });
      await tags.create(root, name.trim(), "HEAD", message?.trim() || undefined);
      await repositories.refresh(root);
    } catch (error) { showError(error); }
  });

  commands.register("gitnexus.stashApplyItem", async (item?: StashTreeItem) => {
    try {
      if (!item) return;
      await stash.apply(item.root, item.entry.index);
      await repositories.refresh(item.root);
    } catch (error) { showError(error); }
  });

  commands.register("gitnexus.stashPopItem", async (item?: StashTreeItem) => {
    try {
      if (!item) return;
      await stash.pop(item.root, item.entry.index);
      await repositories.refresh(item.root);
    } catch (error) { showError(error); }
  });

  commands.register("gitnexus.stashDropItem", async (item?: StashTreeItem) => {
    try {
      if (!item) return;
      const confirm = await vscode.window.showWarningMessage(`Drop stash ${item.entry.ref}?`, { modal: true }, "Drop");
      if (confirm !== "Drop") return;
      await stash.drop(item.root, item.entry.index);
      await repositories.refresh(item.root);
    } catch (error) { showError(error); }
  });

  commands.register("gitnexus.searchCommits", async () => {
    try {
      const root = await resolveWorkspacePath(); if (!root) return;
      const input = await vscode.window.showInputBox({
        prompt: "Search commits",
        placeHolder: "text · author:name · file:path · after:2024-01-01 · code:text (pickaxe)"
      });
      if (!input?.trim()) return;
      const query = input.trim();
      const commits = query.toLowerCase().startsWith("code:")
        ? await search.pickaxe(root, query.slice(5).trim(), "string", { limit: 200 })
        : await search.search(root, { ...parseCommitSearch(query), limit: 200 });
      searchCompareView.setSearch(root, query, commits);
      await vscode.commands.executeCommand("gitnexus.searchCompare.focus");
    } catch (error) { showError(error); }
  });

  commands.register("gitnexus.compareRefs", async () => {
    try {
      const root = await resolveWorkspacePath(); if (!root) return;
      const snapshot = store.get(root) ?? store.all()[0];
      if (!snapshot?.domains) { void vscode.window.showWarningMessage("GitNexus: no repository state yet."); return; }
      const candidates = [
        "HEAD",
        ...snapshot.domains.refs.branches.map(r => r.shortName),
        ...snapshot.domains.refs.tags.map(r => r.shortName)
      ];
      const base = await vscode.window.showQuickPick(candidates, { placeHolder: "Base — compare FROM" });
      if (!base) return;
      const target = await vscode.window.showQuickPick(candidates.filter(c => c !== base), { placeHolder: "Target — compare TO" });
      if (!target) return;
      const canonical = snapshot.identity.rootUri;
      const [ahead, behind, files] = await Promise.all([
        git.log(canonical, 200, { range: `${base}..${target}` }),
        git.log(canonical, 200, { range: `${target}..${base}` }),
        diffs.nameStatus(canonical, [`${base}...${target}`])
      ]);
      searchCompareView.setCompare({ root: canonical, base, target, ahead, behind, files });
      await vscode.commands.executeCommand("gitnexus.searchCompare.focus");
    } catch (error) { showError(error); }
  });

  commands.register("gitnexus.searchCompareClear", async () => {
    searchCompareView.clear();
  });

  const askAiText = async (prompt: string, token: vscode.CancellationToken): Promise<string | undefined> => {
    const config = vscode.workspace.getConfiguration("gitnexus");
    const controller = new AbortController();
    const cancelWatch = token.onCancellationRequested(() => controller.abort());
    try {
      const byok = await askByok(prompt, {
        provider: config.get<string>("ai.provider", "auto"),
        geminiModel: config.get<string>("ai.gemini.model", "gemini-2.5-flash"),
        openAiBaseUrl: config.get<string>("ai.openai.baseUrl", "https://api.openai.com/v1"),
        openAiModel: config.get<string>("ai.openai.model", "gpt-4o-mini")
      }, async key => context.secrets.get(key), fetch, controller.signal);
      if (byok) return byok;
    } finally {
      cancelWatch.dispose();
    }
    const model = await pickChatModel();
    if (!model) return undefined;
    return askModel(model, prompt, token);
  };

  const NO_AI_MESSAGE = "GitNexus: no AI model available. Install GitHub Copilot, or set your own API key with “GitNexus: Set AI API Key”.";

  commands.register("gitnexus.setAiApiKey", async () => {
    try {
      const choice = await vscode.window.showQuickPick([
        { label: "Google Gemini", secret: GEMINI_KEY_SECRET },
        { label: "OpenAI-compatible", secret: OPENAI_KEY_SECRET }
      ], { placeHolder: "Which AI provider's API key?" });
      if (!choice) return;
      const key = await vscode.window.showInputBox({ prompt: `API key for ${choice.label}`, password: true });
      if (!key) return;
      await context.secrets.store(choice.secret, key);
      void vscode.window.showInformationMessage(`GitNexus: ${choice.label} API key saved (stored securely, never in settings).`);
    } catch (error) { showError(error); }
  });

  commands.register("gitnexus.clearAiApiKey", async () => {
    try {
      const choice = await vscode.window.showQuickPick([
        { label: "Google Gemini", secret: GEMINI_KEY_SECRET },
        { label: "OpenAI-compatible", secret: OPENAI_KEY_SECRET }
      ], { placeHolder: "Remove which API key?" });
      if (!choice) return;
      await context.secrets.delete(choice.secret);
      void vscode.window.showInformationMessage(`GitNexus: ${choice.label} API key removed.`);
    } catch (error) { showError(error); }
  });

  commands.register("gitnexus.generateCommitMessage", async () => {
    try {
      const root = await resolveWorkspacePath(); if (!root) return;
      const staged = await diffs.diff(root, ["--cached"]);
      if (!staged.rawPatch.trim()) {
        void vscode.window.showInformationMessage("GitNexus: stage some changes first, then generate a commit message.");
        return;
      }
      const message = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "GitNexus: generating commit message…", cancellable: true },
        (_progress, token) => askAiText(buildCommitMessagePrompt(staged.rawPatch), token)
      );
      if (!message) { void vscode.window.showInformationMessage(NO_AI_MESSAGE); return; }
      const provider = scmProviders.find(p => p.hasRoot(root));
      if (provider) provider.setCommitMessage(message);
      else {
        await vscode.env.clipboard.writeText(message);
        void vscode.window.showInformationMessage("GitNexus: commit message copied to the clipboard (no SCM view for this folder).");
      }
    } catch (error) { showError(error); }
  });

  commands.register("gitnexus.explainCommit", async (item?: CommitTreeItem | string) => {
    try {
      let root: string | undefined;
      let commitId: string | undefined;
      if (typeof item === "string") commitId = item;
      else if (item instanceof CommitTreeItem) { root = item.root; commitId = item.commit.id; }
      if (!root) root = await resolveWorkspacePath();
      if (!root) return;
      commitId ??= "HEAD";
      const details = await commitDetails.get(root, commitId);
      const explanation = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "GitNexus: explaining commit…", cancellable: true },
        (_progress, token) => askAiText(buildExplainCommitPrompt(details.commit.subject, details.commit.body ?? "", details.diff), token)
      );
      if (!explanation) { void vscode.window.showInformationMessage(NO_AI_MESSAGE); return; }
      const document = await vscode.workspace.openTextDocument({
        language: "markdown",
        content: `# ${details.commit.subject}\n\n\`${details.commit.id}\` · ${details.commit.authorName}\n\n${explanation}\n`
      });
      await vscode.window.showTextDocument(document, { preview: false });
    } catch (error) { showError(error); }
  });

  commands.register("gitnexus.remoteFetchItem", async (item?: RemoteTreeItem) => {
    try {
      if (!item) return;
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Fetching ${item.remote.name}…` },
        async () => { await remotes.fetch(item.root, item.remote.name); }
      );
      await repositories.refresh(item.root);
    } catch (error) { showError(error); }
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
