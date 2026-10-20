import { AiContext, AiContextPackage } from "../../domain/ai";
import { RepositorySnapshot } from "../../domain/git";

export interface AiContextSelection {
  /** Commit ids to include (e.g. from the graph selection). */
  commits?: string[];
  /** File paths to include; defaults to the working-tree changes. */
  files?: string[];
  /** Recent-history window when no explicit commits are selected. */
  recentCommits?: number;
}

/**
 * Build an AiContext pinned to the snapshot's generation, plus its
 * provider-neutral Markdown rendering. Pure — the extension wires
 * documents/clipboard/status bar around it.
 */
export function buildAiContextPackage(
  snapshot: RepositorySnapshot,
  selection: AiContextSelection = {}
): AiContextPackage {
  const byId = new Map(snapshot.commits.map(c => [c.id, c]));
  const commitIds = selection.commits?.length
    ? selection.commits.filter(id => byId.has(id))
    : snapshot.commits.slice(0, selection.recentCommits ?? 10).map(c => c.id);

  const diffs = snapshot.status.entries.map(e => ({ path: e.path, kind: e.kind }));
  const files = selection.files?.length
    ? selection.files
    : diffs.map(d => d.path);

  const notices = snapshot.domains?.derived.notices ?? [];
  const promptContext: string[] = [
    `Repository branch: ${snapshot.head.ref ?? "(detached HEAD)"} at ${snapshot.head.commit?.slice(0, 10) ?? "unborn"}`,
    `Working tree: ${snapshot.status.isClean ? "clean" : `${diffs.length} changed file(s)`}`,
    ...notices.map(n => `Limitation: ${n}`),
    ...commitIds.map(id => {
      const commit = byId.get(id)!;
      return `Commit ${id.slice(0, 10)}: ${commit.subject} (${commit.authorName})`;
    })
  ];

  const context: AiContext = {
    repositoryGeneration: snapshot.generation,
    commits: commitIds,
    files,
    diffs,
    promptContext
  };

  const lines = [
    `# GitNexus AI Context`,
    ``,
    `- Generation: ${snapshot.generation} (pinned — rebuild when the repository moves on)`,
    `- Branch: ${snapshot.head.ref ?? "(detached HEAD)"}`,
    `- HEAD: ${snapshot.head.commit ?? "(unborn)"}`,
    `- Working tree: ${snapshot.status.isClean ? "clean" : `${diffs.length} changed file(s)`}`,
    ...(notices.length ? [`- Limitations: ${notices.join(", ")}`] : []),
    ``,
    `## Commits (${commitIds.length})`,
    ...commitIds.map(id => {
      const commit = byId.get(id)!;
      return `- ${id.slice(0, 10)} ${commit.subject} — ${commit.authorName}`;
    }),
    ``,
    `## Changed files (${diffs.length})`,
    ...(diffs.length
      ? diffs.map(d => `- ${d.path} (${d.kind})`)
      : [`(none)`]),
    ``,
    `## Prompt context`,
    ...promptContext.map(line => `- ${line}`),
    ``
  ];

  return { context, markdown: lines.join("\n"), builtAt: Date.now() };
}

/**
 * Holds the most recently built context and answers the §29 staleness
 * question: a context is stale when the repository generation has moved
 * past the generation it was pinned to.
 */
export class AiContextStore {
  private current: AiContextPackage | undefined;
  private readonly selection = new Set<string>();

  set(pkg: AiContextPackage): void {
    this.current = pkg;
  }

  get(): AiContextPackage | undefined {
    return this.current;
  }

  isStale(currentGeneration: number): boolean {
    return this.current !== undefined &&
      this.current.context.repositoryGeneration !== currentGeneration;
  }

  /** Graph/AI selection (Layer D): commits the user picked for context. */
  addToSelection(commitId: string): void {
    this.selection.add(commitId);
  }

  selectedCommits(): string[] {
    return [...this.selection];
  }

  clearSelection(): void {
    this.selection.clear();
  }
}
