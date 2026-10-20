import { FileChangeKind } from "./git";

/**
 * Layer D — AI state (REPOSITORY_STATE_MODEL §29). AI context is built
 * from a state-model snapshot and pinned to that snapshot's generation;
 * when the generation moves on, the context is stale and the UI must say
 * so and offer a rebuild. AI state is never authoritative Git state.
 */

export interface DiffReference {
  path: string;
  kind: FileChangeKind;
}

export interface AiContext {
  repositoryGeneration: number;
  commits: string[];
  files: string[];
  diffs: DiffReference[];
  promptContext: string[];
}

export interface AiContextPackage {
  context: AiContext;
  markdown: string;
  builtAt: number;
}
