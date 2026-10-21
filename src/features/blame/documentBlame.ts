import * as vscode from "vscode";
import { BlameCache, BlameTarget } from "./blameCache";
import { BlameLine } from "./blameService";

/**
 * The one place annotation surfaces decide disk vs buffer: a clean
 * document blames the file on disk (fingerprint-cached); a dirty one
 * blames its in-memory text via `git blame --contents`, so annotations
 * track unsaved edits exactly.
 */
export function blameForDocument(
  cache: BlameCache,
  target: BlameTarget,
  document: vscode.TextDocument
): Promise<BlameLine[]> {
  return document.isDirty
    ? cache.getBuffer(target.root, target.relativePath, document.getText())
    : cache.get(target.root, target.relativePath);
}
