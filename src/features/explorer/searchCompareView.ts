import * as vscode from "vscode";
import { CommitSummary } from "../../domain/git";
import { CommitTreeItem } from "./commitsView";

export interface ChangedFile {
  status: string;
  path: string;
  oldPath?: string;
}

export interface CompareData {
  root: string;
  base: string;
  target: string;
  /** Commits in target but not in base. */
  ahead: CommitSummary[];
  /** Commits in base but not in target. */
  behind: CommitSummary[];
  /** Files changed between the merge-base and target. */
  files: ChangedFile[];
}

class SectionItem extends vscode.TreeItem {
  constructor(
    label: string,
    readonly section: "ahead" | "behind" | "files",
    count: number
  ) {
    super(label, vscode.TreeItemCollapsibleState.Expanded);
    this.description = `${count}`;
    this.contextValue = "compareSection";
    this.iconPath = new vscode.ThemeIcon(
      section === "files" ? "files" : section === "ahead" ? "arrow-up" : "arrow-down"
    );
  }
}

export class CompareFileItem extends vscode.TreeItem {
  constructor(
    readonly root: string,
    readonly base: string,
    readonly target: string,
    readonly file: ChangedFile
  ) {
    super(file.path, vscode.TreeItemCollapsibleState.None);
    this.description = file.status + (file.oldPath ? ` · from ${file.oldPath}` : "");
    this.contextValue = "compareFile";
    this.iconPath = new vscode.ThemeIcon(
      file.status.startsWith("A") ? "diff-added"
        : file.status.startsWith("D") ? "diff-removed"
        : file.status.startsWith("R") ? "diff-renamed"
        : "diff-modified"
    );
    this.command = {
      command: "vscode.open",
      title: "Open File",
      arguments: [vscode.Uri.file(`${root}/${file.path}`)]
    };
  }
}

function placeholder(text: string): vscode.TreeItem {
  const item = new vscode.TreeItem(text, vscode.TreeItemCollapsibleState.None);
  item.contextValue = "placeholder";
  return item;
}

/**
 * Search & Compare view. Two result modes fed by commands:
 * `gitnexus.searchCommits` (qualifier search + `code:` pickaxe) and
 * `gitnexus.compareRefs` (ahead/behind commits + changed files between
 * two refs). State lives in the provider; the view is a pure rendering
 * of the last result set.
 */
export class SearchCompareViewProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly emitter = new vscode.EventEmitter<vscode.TreeItem | undefined | void>();
  readonly onDidChangeTreeData = this.emitter.event;

  private mode: "empty" | "search" | "compare" = "empty";
  private searchData: { root: string; query: string; commits: CommitSummary[] } | undefined;
  private compareData: CompareData | undefined;

  setSearch(root: string, query: string, commits: CommitSummary[]): void {
    this.mode = "search";
    this.searchData = { root, query, commits };
    this.compareData = undefined;
    this.emitter.fire();
  }

  setCompare(data: CompareData): void {
    this.mode = "compare";
    this.compareData = data;
    this.searchData = undefined;
    this.emitter.fire();
  }

  clear(): void {
    this.mode = "empty";
    this.searchData = undefined;
    this.compareData = undefined;
    this.emitter.fire();
  }

  dispose(): void {
    this.emitter.dispose();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: vscode.TreeItem): vscode.TreeItem[] {
    if (this.mode === "search" && this.searchData) {
      if (element) return [];
      const { root, query, commits } = this.searchData;
      if (commits.length === 0) return [placeholder(`No commits match "${query}"`)];
      return commits.map(commit => new CommitTreeItem(root, commit));
    }
    if (this.mode === "compare" && this.compareData) {
      const data = this.compareData;
      if (!element) {
        return [
          new SectionItem(`In ${data.target} not in ${data.base}`, "ahead", data.ahead.length),
          new SectionItem(`In ${data.base} not in ${data.target}`, "behind", data.behind.length),
          new SectionItem(`Changed files (${data.base}…${data.target})`, "files", data.files.length)
        ];
      }
      if (element instanceof SectionItem) {
        if (element.section === "ahead") return data.ahead.map(c => new CommitTreeItem(data.root, c));
        if (element.section === "behind") return data.behind.map(c => new CommitTreeItem(data.root, c));
        return data.files.map(file => new CompareFileItem(data.root, data.base, data.target, file));
      }
      return [];
    }
    return [placeholder("Run Search Commits or Compare Refs to see results here")];
  }
}
