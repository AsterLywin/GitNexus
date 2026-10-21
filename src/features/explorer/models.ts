import { CommitSummary } from "../../domain/git";
import { GitRef } from "../../domain/ref";
import { GitRemote } from "../../git/remoteService";
import { StashEntry } from "../stash/stashService";

/**
 * Pure tree-model builders for the sidebar views. Providers feed them
 * snapshot data and map the results to TreeItems; keeping the shaping
 * pure makes ordering/grouping unit-testable without VS Code.
 */

export interface BranchNode {
  ref: GitRef;
  /** Display name: shortName without the remote prefix for remote branches. */
  label: string;
  isCurrent: boolean;
  isRemote: boolean;
}

export function branchNodes(refs: GitRef[]): { local: BranchNode[]; remote: BranchNode[] } {
  const toNode = (ref: GitRef, isRemote: boolean): BranchNode => ({
    ref,
    label: ref.shortName,
    isCurrent: ref.isCurrent === true,
    isRemote
  });
  const byName = (a: BranchNode, b: BranchNode) => a.label.localeCompare(b.label);
  const local = refs
    .filter(r => r.kind === "localBranch")
    .map(r => toNode(r, false))
    .sort((a, b) => Number(b.isCurrent) - Number(a.isCurrent) || byName(a, b));
  const remote = refs
    .filter(r => r.kind === "remoteBranch")
    .map(r => toNode(r, true))
    .sort(byName);
  return { local, remote };
}

export interface TagNode {
  ref: GitRef;
  label: string;
}

export function tagNodes(refs: GitRef[]): TagNode[] {
  return refs
    .filter(r => r.kind === "tag")
    .map(ref => ({ ref, label: ref.shortName }))
    .sort((a, b) => b.label.localeCompare(a.label, undefined, { numeric: true }));
}

export interface RemoteNode {
  remote: GitRemote;
  label: string;
  detail: string;
}

export function remoteNodes(remotes: GitRemote[]): RemoteNode[] {
  return remotes
    .map(remote => ({
      remote,
      label: remote.name,
      detail: remote.fetchUrl ?? remote.pushUrl ?? ""
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export interface StashNode {
  entry: StashEntry;
  label: string;
}

export function stashNodes(stashes: StashEntry[]): StashNode[] {
  return [...stashes]
    .sort((a, b) => a.index - b.index)
    .map(entry => ({ entry, label: entry.subject || entry.ref }));
}

export interface CommitNode {
  commit: CommitSummary;
  label: string;
  detail: string;
}

export function commitNodes(commits: CommitSummary[], limit = 100): CommitNode[] {
  return commits.slice(0, limit).map(commit => ({
    commit,
    label: commit.subject || commit.id.slice(0, 8),
    detail: `${commit.authorName} · ${commit.id.slice(0, 8)}`
  }));
}
