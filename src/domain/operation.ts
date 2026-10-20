export type GitOperation =
  | "rebase"
  | "merge"
  | "cherry-pick"
  | "revert"
  | "reset"
  | "checkout"
  | "branch"
  | "worktree"
  | "stage"
  | "commit"
  | "stash"
  | "reset";

export type OperationPhase =
  | "idle"
  | "validating"
  | "running"
  | "conflict"
  | "completed"
  | "failed"
  | "cancelled";

export interface OperationState {
  operation: GitOperation;
  phase: OperationPhase;
  rootUri: string;
  startedAt?: number;
  finishedAt?: number;
  command?: string;
  exitCode?: number;
  message?: string;
  conflictPaths: string[];
  generation: number;
}
