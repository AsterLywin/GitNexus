export type RefKind = "localBranch" | "remoteBranch" | "tag" | "head";

export interface GitRef {
  name: string;
  shortName: string;
  kind: RefKind;
  objectId: string;
  upstream?: string;
  ahead?: number;
  behind?: number;
  isCurrent?: boolean;
}

export interface RefSnapshot {
  refs: GitRef[];
  branches: GitRef[];
  remotes: GitRef[];
  tags: GitRef[];
}
