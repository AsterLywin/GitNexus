import * as vscode from "vscode";
import { ConflictService } from "./conflictService";

export const STAGE_SCHEME = "gitnexus-stage";

const STAGE_NAMES: Record<number, string> = { 1: "BASE", 2: "OURS", 3: "THEIRS" };

/**
 * Read-only virtual documents for the three index stages of a conflicted
 * file, so the conflict panel can open base / ours / theirs and diff
 * ours ↔ theirs with VS Code's own editors.
 */
export class StageDocumentProvider implements vscode.TextDocumentContentProvider {
  constructor(private readonly service: ConflictService) {}

  static uriFor(root: string, path: string, stage: 1 | 2 | 3): vscode.Uri {
    return vscode.Uri.from({
      scheme: STAGE_SCHEME,
      path: `/${STAGE_NAMES[stage]}/${path}`,
      query: JSON.stringify({ root, stage, path })
    });
  }

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const { root, stage, path } = JSON.parse(uri.query) as {
      root: string;
      stage: 1 | 2 | 3;
      path: string;
    };
    return this.service.stageContent(root, path, stage);
  }
}
