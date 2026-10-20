export type GitObjectId = string;

export interface RepositoryIdentity {
  rootUri: string;
  gitDir: string;
  commonDir?: string;
  isBare: boolean;
}

export interface HeadState {
  ref?: string;
  commit?: GitObjectId;
  detached: boolean;
}

export type FileChangeKind =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "copied"
  | "untracked"
  | "ignored"
  | "unmerged";

export interface WorkingTreeEntry {
  path: string;
  indexStatus: string;
  worktreeStatus: string;
  kind: FileChangeKind;
  originalPath?: string;
}

export interface RepositoryStatus {
  branch?: string;
  ahead: number;
  behind: number;
  head?: GitObjectId;
  entries: WorkingTreeEntry[];
  isClean: boolean;
}

export interface CommitSummary {
  id: GitObjectId;
  parents: GitObjectId[];
  authorName: string;
  authorEmail: string;
  authorTimestamp: number;
  committerName: string;
  committerEmail: string;
  committerTimestamp: number;
  subject: string;
  body?: string;
}

export interface RepositorySnapshot {
  identity: RepositoryIdentity;
  head: HeadState;
  status: RepositoryStatus;
  commits: CommitSummary[];
  generation: number;
  updatedAt: number;
}

export interface RepositoryEvent {
  type:
    | "repositoryOpened"
    | "stateRefreshed"
    | "repositoryClosed"
    | "mutationStarted"
    | "mutationCompleted";
  rootUri: string;
  generation: number;
  timestamp: number;
}
