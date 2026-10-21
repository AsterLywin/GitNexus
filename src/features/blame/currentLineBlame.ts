import * as vscode from "vscode";
import { BlameCache } from "./blameCache";
import { BlameLine } from "./blameService";
import { formatRelativeTime } from "./format";

/**
 * GitLens-style current-line blame: a quiet inline annotation at the end
 * of the line the cursor is on — "Author, 3 days ago • summary". Reads
 * the working-tree file from disk; while the buffer is dirty the
 * attribution may lag the edit, so the annotation hides until save.
 */
export class CurrentLineBlameController {
  private readonly decoration = vscode.window.createTextEditorDecorationType({
    after: {
      color: new vscode.ThemeColor("editorCodeLens.foreground"),
      fontStyle: "italic",
      margin: "0 0 0 4em"
    }
  });
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly cache: BlameCache) {
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(() => this.schedule()),
      vscode.window.onDidChangeTextEditorSelection(event => {
        if (event.textEditor === vscode.window.activeTextEditor) this.schedule();
      }),
      vscode.workspace.onDidSaveTextDocument(() => this.schedule(0)),
      vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration("gitnexus.blame")) this.schedule(0);
      })
    );
    this.schedule(0);
  }

  /** Re-render the annotation for the active editor (e.g. after a state refresh). */
  refresh(): void {
    this.schedule(0);
  }

  private get enabled(): boolean {
    return vscode.workspace.getConfiguration("gitnexus").get<boolean>("blame.currentLine.enabled", true);
  }

  private schedule(delayMs = 150): void {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const key = editor.document.uri.toString();
    const existing = this.timers.get(key);
    if (existing) clearTimeout(existing);
    this.timers.set(key, setTimeout(() => {
      this.timers.delete(key);
      void this.update(editor);
    }, delayMs));
  }

  private async update(editor: vscode.TextEditor): Promise<void> {
    if (editor !== vscode.window.activeTextEditor) return;
    const clear = () => editor.setDecorations(this.decoration, []);
    if (!this.enabled || editor.document.uri.scheme !== "file" || editor.document.isDirty) {
      clear();
      return;
    }
    const target = this.cache.targetFor(editor.document.uri.fsPath);
    if (!target) { clear(); return; }

    let lines: BlameLine[];
    try {
      lines = await this.cache.get(target.root, target.relativePath);
    } catch {
      clear();
      return;
    }
    if (editor !== vscode.window.activeTextEditor) return;

    const lineNumber = editor.selection.active.line + 1;
    const entry = lines.find(l => l.line === lineNumber);
    if (!entry) { clear(); return; }

    const text = entry.uncommitted
      ? "You • Uncommitted changes"
      : `${entry.author}, ${formatRelativeTime(entry.timestamp)} • ${truncate(entry.summary, 72)}`;
    const range = new vscode.Range(
      editor.selection.active.line,
      editor.document.lineAt(editor.selection.active.line).range.end.character,
      editor.selection.active.line,
      editor.document.lineAt(editor.selection.active.line).range.end.character
    );
    editor.setDecorations(this.decoration, [{
      range,
      renderOptions: { after: { contentText: text } }
    }]);
  }

  dispose(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.decoration.dispose();
    for (const d of this.disposables) d.dispose();
  }
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max - 1).trimEnd() + "…";
}
