import { RepositoryEvent, RepositorySnapshot } from "../domain/git";
import {
  ActiveGitOperation,
  DerivedState,
  RefreshScope,
  RepositoryDomains,
  RepositoryStateEvent,
  freshDomains,
  scopesForEvent
} from "../domain/state";
import { BranchService } from "../features/branch/branchService";
import { StashEntry } from "../features/stash/stashService";
import { StashService } from "../features/stash/stashService";
import { WorktreeService } from "../features/worktree/worktreeService";
import { GitProcessExecutor } from "../git/processExecutor";
import { GitService } from "../git/gitService";
import { RefService } from "../git/refService";
import { RemoteService } from "../git/remoteService";
import { RepositoryOperationDetector, DetectedOperation } from "../git/repositoryOperationDetector";
import { SubmoduleService } from "../git/submoduleService";
import { RepositoryEventBus } from "../state/eventBus";
import { RepositoryStateStore } from "../state/repositoryStateStore";

export interface RepositoryManagerDeps {
  executor?: GitProcessExecutor;
  detector?: RepositoryOperationDetector;
  bus?: RepositoryEventBus;
  /** Adaptive validation polling interval (§18); 0 disables. Default 30s. */
  pollIntervalMs?: number;
  /** Burst-coalescing window for event-driven refresh (§19). Default 120ms. */
  debounceMs?: number;
}

interface DomainServices {
  refs: RefService;
  remotes: RemoteService;
  worktrees: WorktreeService;
  stashes: StashService;
  submodules: SubmoduleService;
  branches: BranchService;
  detector: RepositoryOperationDetector;
  executor: import("../git/processExecutor").GitProcessExecutor;
}

const IDLE_OPERATION: DetectedOperation = { phase: "idle", conflictPaths: [] };

/**
 * Repository lifecycle + refresh transactions (REPOSITORY_STATE_MODEL
 * §18–§21, §26, §36–§38). A refresh reads the required state, builds one
 * coherent snapshot, commits it to the store, and only then publishes —
 * one store update plus the typed events the snapshot diff implies.
 */
export class RepositoryManager {
  private readonly listeners = new Set<(event: RepositoryEvent) => void>();
  private readonly services?: DomainServices;
  private readonly bus?: RepositoryEventBus;
  private readonly pollIntervalMs: number;
  private readonly debounceMs: number;
  private readonly shallowByRoot = new Map<string, boolean>();
  private readonly pendingScopes = new Map<string, Set<RefreshScope>>();
  private readonly pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly pollTimers = new Map<string, ReturnType<typeof setInterval>>();
  private readonly unsubscribeBus?: () => void;

  constructor(
    private readonly git: GitService,
    private readonly store: RepositoryStateStore,
    deps: RepositoryManagerDeps = {}
  ) {
    this.bus = deps.bus;
    this.pollIntervalMs = deps.pollIntervalMs ?? 30000;
    this.debounceMs = deps.debounceMs ?? 120;
    if (deps.executor) {
      const executor = deps.executor;
      this.services = {
        refs: new RefService(executor, 10000),
        remotes: new RemoteService(executor, 10000),
        worktrees: new WorktreeService(executor, 10000),
        stashes: new StashService(executor, 10000),
        submodules: new SubmoduleService(executor, 10000),
        branches: new BranchService(executor, 10000),
        detector: deps.detector ?? new RepositoryOperationDetector(executor, 10000),
        executor
      };
    }
    if (this.bus) {
      this.unsubscribeBus = this.bus.subscribe((rootUri, event) => {
        this.scheduleScopedRefresh(rootUri, scopesForEvent(event));
      });
    }
  }

  onEvent(listener: (event: RepositoryEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async open(path: string): Promise<RepositorySnapshot> {
    const identity = await this.git.discoverRepository(path);
    const snapshot = await this.refresh(identity.rootUri, identity.rootUri);
    this.startPolling(identity.rootUri);
    return snapshot;
  }

  /** Full refresh transaction (§20): every domain, one snapshot commit. */
  async refresh(rootUri: string, path = rootUri): Promise<RepositorySnapshot> {
    const identity = await this.git.discoverRepository(path);
    const previous = this.store.get(identity.rootUri);
    const generation = (previous?.generation ?? 0) + 1;
    const now = Date.now();

    const [head, status, commits, domains] = await Promise.all([
      this.git.head(identity.rootUri),
      this.git.status(identity.rootUri),
      this.git.log(identity.rootUri),
      this.fetchDomains(identity.rootUri, generation, previous)
    ]);

    const snapshot: RepositorySnapshot = {
      identity, head, status, commits, generation, updatedAt: now, domains
    };
    if (snapshot.domains) {
      snapshot.domains.derived = computeDerived(
        snapshot, generation, snapshot.domains.derived.aheadBehind,
        this.shallowByRoot.get(identity.rootUri) ?? false
      );
    }

    this.store.set(snapshot);
    this.emit({
      type: previous ? "stateRefreshed" : "repositoryOpened",
      rootUri: identity.rootUri,
      generation,
      timestamp: now
    });
    this.publishDiff(previous, snapshot);
    this.propagateSharedState(snapshot);
    return snapshot;
  }

  /**
   * Scoped refresh (§37): re-reads only the requested domains and merges
   * them into the previous snapshot as one transaction. Other domains keep
   * their values and their original freshness generations.
   */
  async refreshScoped(rootUri: string, scopes: RefreshScope[]): Promise<RepositorySnapshot> {
    const previous = this.store.get(rootUri);
    if (!previous || scopes.includes("all") || !this.services) {
      return this.refresh(rootUri);
    }
    const svc = this.services;
    const generation = previous.generation + 1;
    const now = Date.now();
    const wanted = new Set(scopes);

    const snapshot: RepositorySnapshot = {
      ...previous,
      generation,
      updatedAt: now,
      domains: previous.domains
        ? { ...previous.domains, freshness: { ...previous.domains.freshness } }
        : undefined
    };
    const domains = snapshot.domains;

    const jobs: Array<Promise<void>> = [];
    const fresh = (domain: "head" | "refs" | "status" | "worktrees" | "operation" | "remotes" | "stashes" | "submodules" | "derived") => {
      if (domains) {
        domains.freshness[domain] = { observedAt: now, generation, source: domain === "derived" ? "derived" : "git", stale: false };
      }
    };

    if (wanted.has("head")) {
      jobs.push(Promise.all([this.git.head(rootUri), this.git.log(rootUri)]).then(([head, commits]) => {
        snapshot.head = head;
        snapshot.commits = commits;
        fresh("head");
      }).catch(() => undefined));
    }
    if (wanted.has("status")) {
      jobs.push(this.git.status(rootUri).then(status => {
        snapshot.status = status;
        fresh("status");
      }).catch(() => undefined));
    }
    if (domains && wanted.has("refs")) {
      jobs.push(svc.refs.list(rootUri).then(refs => {
        domains.refs = refs;
        fresh("refs");
      }).catch(() => undefined));
      jobs.push(svc.branches.list(rootUri).then(list => {
        domains.derived = {
          ...domains.derived,
          aheadBehind: Object.fromEntries(list.map(b => [b.name, { ahead: b.ahead, behind: b.behind }]))
        };
      }).catch(() => undefined));
    }
    if (domains && wanted.has("remotes")) {
      jobs.push(svc.remotes.list(rootUri).then(remotes => {
        domains.remotes = remotes;
        fresh("remotes");
      }).catch(() => undefined));
    }
    if (domains && wanted.has("worktrees")) {
      jobs.push(svc.worktrees.list(rootUri).then(worktrees => {
        domains.worktrees = worktrees;
        domains.primaryWorktree = worktrees[0]?.path;
        fresh("worktrees");
      }).catch(() => undefined));
    }
    if (domains && wanted.has("operation")) {
      jobs.push(svc.detector.detect(rootUri).then(operation => {
        domains.operation = operation;
        fresh("operation");
      }).catch(() => undefined));
    }
    if (domains && wanted.has("refs")) {
      // Stash state is ref state (refs/stash), so it rides the refs scope (§37).
      jobs.push(svc.stashes.list(rootUri).then(stashes => {
        domains.stashes = stashes;
      }).catch(() => undefined));
    }
    if (domains && wanted.has("submodules")) {
      jobs.push(svc.submodules.status(rootUri).then(submodules => {
        domains.submodules = submodules;
        fresh("submodules");
      }).catch(() => undefined));
    }

    await Promise.all(jobs);

    if (domains) {
      domains.derived = computeDerived(
        snapshot, generation, domains.derived.aheadBehind,
        this.shallowByRoot.get(rootUri) ?? false
      );
      fresh("derived");
    }

    this.store.set(snapshot);
    this.emit({ type: "stateRefreshed", rootUri, generation, timestamp: now });
    this.publishDiff(previous, snapshot);
    this.propagateSharedState(snapshot);
    return snapshot;
  }

  /** Coalesce event bursts into one scoped refresh (§19). */
  scheduleScopedRefresh(rootUri: string, scopes: RefreshScope[]): void {
    const pending = this.pendingScopes.get(rootUri) ?? new Set<RefreshScope>();
    for (const scope of scopes) pending.add(scope);
    this.pendingScopes.set(rootUri, pending);
    if (this.pendingTimers.has(rootUri)) return;
    const timer = setTimeout(() => {
      this.pendingTimers.delete(rootUri);
      const merged = [...(this.pendingScopes.get(rootUri) ?? [])];
      this.pendingScopes.delete(rootUri);
      if (merged.length) {
        this.refreshScoped(rootUri, merged).catch(() => undefined);
      }
    }, this.debounceMs);
    timer.unref?.();
    this.pendingTimers.set(rootUri, timer);
  }

  /** Mark domains stale without refreshing (§14) — e.g. window lost focus. */
  invalidate(rootUri: string, domains: Array<"head" | "refs" | "status" | "worktrees" | "operation" | "remotes" | "stashes" | "submodules" | "derived">): void {
    this.store.markStale(rootUri, domains);
  }

  get(rootUri: string): RepositorySnapshot | undefined {
    return this.store.get(rootUri);
  }

  dispose(): void {
    this.unsubscribeBus?.();
    for (const timer of this.pendingTimers.values()) clearTimeout(timer);
    for (const timer of this.pollTimers.values()) clearInterval(timer);
    this.pendingTimers.clear();
    this.pollTimers.clear();
  }

  // -- internals -----------------------------------------------------------

  private async fetchDomains(
    root: string,
    generation: number,
    previous?: RepositorySnapshot
  ): Promise<RepositoryDomains | undefined> {
    if (!this.services) return previous?.domains;
    const svc = this.services;
    const fallback = previous?.domains;
    const settle = async <T,>(job: Promise<T>, fb: T | undefined): Promise<T | undefined> =>
      job.catch(() => fb);

    const [refs, remotes, worktrees, operation, stashes, submodules, branches, shallow] = await Promise.all([
      settle(svc.refs.list(root), fallback?.refs),
      settle(svc.remotes.list(root), fallback?.remotes),
      settle(svc.worktrees.list(root), fallback?.worktrees),
      settle(svc.detector.detect(root), fallback?.operation),
      settle(svc.stashes.list(root), fallback?.stashes),
      settle(svc.submodules.status(root), fallback?.submodules),
      settle(svc.branches.list(root), undefined),
      settle(
        svc.executor.exec(["rev-parse", "--is-shallow-repository"], { cwd: root, timeoutMs: 10000 })
          .then(r => r.stdout.trim() === "true"),
        fallback?.derived.notices.includes("shallow-clone") ?? false
      )
    ]);
    if (shallow !== undefined) this.shallowByRoot.set(root, shallow);

    const domains: RepositoryDomains = {
      refs: refs ?? { refs: [], branches: [], remotes: [], tags: [] },
      remotes: remotes ?? [],
      worktrees: worktrees ?? [],
      primaryWorktree: worktrees?.[0]?.path,
      operation: operation ?? IDLE_OPERATION,
      stashes: stashes ?? [],
      submodules: submodules ?? [],
      derived: {
        basedOnGeneration: generation,
        clean: true,
        conflicted: false,
        changedFiles: 0,
        aheadBehind: Object.fromEntries((branches ?? []).map(b => [b.name, { ahead: b.ahead, behind: b.behind }])),
        conflictPaths: [],
        notices: []
      },
      freshness: freshDomains(generation)
    };
    return domains;
  }

  private publishDiff(previous: RepositorySnapshot | undefined, next: RepositorySnapshot): void {
    if (!this.bus || !previous) return;
    for (const event of diffSnapshotEvents(previous, next)) {
      this.bus.emit(next.identity.rootUri, event);
    }
  }

  /**
   * Multi-worktree semantics (§26): refs and objects are shared through
   * the common Git directory, so a refresh here marks sibling worktrees'
   * ref state stale and schedules their own scoped refresh.
   */
  private propagateSharedState(snapshot: RepositorySnapshot): void {
    const commonDir = snapshot.identity.commonDir ?? snapshot.identity.gitDir;
    for (const sibling of this.store.byCommonDir(commonDir)) {
      const other = sibling.identity.rootUri;
      if (other === snapshot.identity.rootUri) continue;
      this.store.markStale(other, ["refs"]);
      this.bus?.emit(other, { type: "REFS_CHANGED" });
    }
  }

  private startPolling(rootUri: string): void {
    if (this.pollIntervalMs <= 0 || this.pollTimers.has(rootUri)) return;
    const timer = setInterval(() => {
      const snapshot = this.store.get(rootUri);
      if (!snapshot) return;
      this.git.head(rootUri).then(head => {
        if (head.commit !== snapshot.head.commit) {
          this.scheduleScopedRefresh(rootUri, ["head", "status", "refs"]);
        }
      }).catch(() => undefined);
    }, this.pollIntervalMs);
    timer.unref?.();
    this.pollTimers.set(rootUri, timer);
  }

  private emit(event: RepositoryEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

function computeDerived(
  snapshot: RepositorySnapshot,
  generation: number,
  aheadBehind: Record<string, { ahead: number; behind: number }>,
  shallow = false
): DerivedState {
  const operation = snapshot.domains?.operation ?? IDLE_OPERATION;
  const notices: DerivedState["notices"] = [];
  if (shallow) notices.push("shallow-clone");
  if (snapshot.head.detached) notices.push("detached-head");
  if (snapshot.domains && snapshot.domains.remotes.length === 0) notices.push("no-remotes");
  if (snapshot.domains && snapshot.domains.refs.tags.length === 0) notices.push("no-tags");
  return {
    basedOnGeneration: generation,
    clean: snapshot.status.isClean,
    conflicted: operation.phase === "conflict" || snapshot.status.entries.some(e => e.kind === "unmerged"),
    changedFiles: snapshot.status.entries.length,
    aheadBehind,
    conflictPaths: operation.conflictPaths,
    notices
  };
}

/**
 * Derive typed state events from a snapshot transition (§15). Pure and
 * exported for testing. Domain-level diffs are skipped when either side
 * lacks domain data.
 */
export function diffSnapshotEvents(
  previous: RepositorySnapshot,
  next: RepositorySnapshot
): RepositoryStateEvent[] {
  const events: RepositoryStateEvent[] = [];

  if (previous.head.commit !== next.head.commit || previous.head.ref !== next.head.ref) {
    events.push({ type: "HEAD_CHANGED" });
  }

  const prevEntries = new Map(previous.status.entries.map(e => [e.path, e]));
  const nextEntries = new Map(next.status.entries.map(e => [e.path, e]));
  let indexChanged = previous.status.entries.length !== next.status.entries.length;
  let worktreeChanged = indexChanged;
  for (const [path, entry] of nextEntries) {
    const before = prevEntries.get(path);
    if (!before) { indexChanged = true; worktreeChanged = true; continue; }
    if (before.indexStatus !== entry.indexStatus) indexChanged = true;
    if (before.worktreeStatus !== entry.worktreeStatus || before.kind !== entry.kind) worktreeChanged = true;
  }
  if (indexChanged) events.push({ type: "INDEX_CHANGED" });
  if (worktreeChanged) {
    events.push({ type: "WORKTREE_CHANGED", paths: next.status.entries.map(e => e.path) });
  }

  const prev = previous.domains;
  const curr = next.domains;
  if (prev && curr) {
    const refSignature = (d: RepositoryDomains) =>
      d.refs.refs.map(r => `${r.name}:${r.objectId}:${r.upstream ?? ""}`).join("|");
    const stashSignature = (list: StashEntry[]) => list.map(s => `${s.ref}:${s.subject}`).join("|");
    if (refSignature(prev) !== refSignature(curr) || stashSignature(prev.stashes) !== stashSignature(curr.stashes)) {
      events.push({ type: "REFS_CHANGED" });
    }

    const prevOp = prev.operation;
    const currOp = curr.operation;
    if (prevOp.phase !== currOp.phase || prevOp.operation !== currOp.operation) {
      if (prevOp.phase === "idle" && currOp.phase !== "idle") {
        events.push({ type: "OPERATION_STARTED", operation: (currOp.operation ?? null) as ActiveGitOperation });
      } else if (prevOp.phase !== "idle" && currOp.phase === "idle") {
        events.push({ type: "OPERATION_COMPLETED" });
      } else {
        events.push({ type: "OPERATION_CHANGED" });
      }
    }

    const worktreeSignature = (d: RepositoryDomains) => d.worktrees.map(w => w.path).join("|");
    if (worktreeSignature(prev) !== worktreeSignature(curr)) {
      events.push({ type: "WORKTREE_LIST_CHANGED" });
    }

    const remoteSignature = (d: RepositoryDomains) =>
      d.remotes.map(r => `${r.name}:${r.fetchUrl ?? ""}:${r.pushUrl ?? ""}`).join("|");
    if (remoteSignature(prev) !== remoteSignature(curr)) {
      const changed = curr.remotes.find(r =>
        !prev.remotes.some(p => p.name === r.name && p.fetchUrl === r.fetchUrl && p.pushUrl === r.pushUrl));
      events.push({ type: "REMOTE_UPDATED", remote: changed?.name ?? "" });
    }

    const submoduleSignature = (d: RepositoryDomains) =>
      d.submodules.map(s => `${s.path}:${s.commit}:${s.status}`).join("|");
    if (submoduleSignature(prev) !== submoduleSignature(curr)) {
      events.push({ type: "SUBMODULE_CHANGED" });
    }
  }

  return events;
}
