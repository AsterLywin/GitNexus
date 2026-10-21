import * as vscode from "vscode";
import { BlameCache } from "./blameCache";
import { BlameLine } from "./blameService";
import { formatRelativeShort, heatBucket } from "./format";

const MAX_LINES = 5000;
const STATE_KEY = "gitnexus.blameGutter.enabled";

/**
 * Full-file blame annotations in the editor's left margin (toggle:
 * `gitnexus.blameToggle`), with an optional age heat tint per line.
 * Annotations read the working-tree file from disk; dirty buffers are
 * left unannotated until saved so line numbers can never drift.
 */
export class BlameGutterController {
  private readonly textType = vscode.window.createTextEditorDecorationType({});
  // Per-range background colors are not supported by the decoration API,
  // so heat uses one whole-line type per age bucket (hot = newer).
  private readonly heatTypes = Array.from({ length: 10 }, (_, bucket) =>
    vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      backgroundColor: `rgba(74, 144, 226, ${(0.16 - bucket * 0.016).toFixed(3)})`
    })
  );
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly cache: BlameCache,
    private readonly state: vscode.Memento
  ) {
    this.disposables.push(
      vscode.window.onDidChangeVisibleTextEditors(editors => {
        for (const editor of editors) void this.apply(editor);
      }),
      vscode.workspace.onDidSaveTextDocument(document => {
        for (const editor of vscode.window.visibleTextEditors) {
          if (editor.document === document) void this.apply(editor);
        }
      }),
      vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration("gitnexus.blame")) this.refreshAll();
      })
    );
    if (this.enabled) this.refreshAll();
  }

  get enabled(): boolean {
    return this.state.get<boolean>(STATE_KEY, false);
  }

  async toggle(): Promise<void> {
    await this.state.update(STATE_KEY, !this.enabled);
    this.refreshAll();
  }

  refreshAll(): void {
    for (const editor of vscode.window.visibleTextEditors) void this.apply(editor);
  }

  private clear(editor: vscode.TextEditor): void {
    editor.setDecorations(this.textType, []);
    for (const type of this.heatTypes) editor.setDecorations(type, []);
  }

  private async apply(editor: vscode.TextEditor): Promise<void> {
    if (!this.enabled) { this.clear(editor); return; }
    const document = editor.document;
    if (document.uri.scheme !== "file" || document.isDirty || document.lineCount > MAX_LINES) {
      this.clear(editor);
      return;
    }
    const target = this.cache.targetFor(document.uri.fsPath);
    if (!target) { this.clear(editor); return; }

    let lines: BlameLine[];
    try {
      lines = await this.cache.get(target.root, target.relativePath);
    } catch {
      this.clear(editor);
      return;
    }
    if (!this.enabled || editor.document !== document) return;

    const authorWidth = Math.min(18, Math.max(4, ...lines.map(l => displayAuthor(l).length)));
    const stamps = lines.filter(l => !l.uncommitted).map(l => l.timestamp);
    const newest = stamps.length ? Math.max(...stamps) : 0;
    const oldest = stamps.length ? Math.min(...stamps) : 0;
    const heatEnabled = vscode.workspace.getConfiguration("gitnexus").get<boolean>("blame.gutter.heatmap", true);

    const texts: vscode.DecorationOptions[] = [];
    const heats: vscode.DecorationOptions[][] = this.heatTypes.map(() => []);
    for (const entry of lines) {
      const lineIndex = entry.line - 1;
      if (lineIndex < 0 || lineIndex >= document.lineCount) continue;
      const author = displayAuthor(entry).padEnd(authorWidth, " ");
      const age = entry.uncommitted ? "now" : formatRelativeShort(entry.timestamp);
      texts.push({
        range: new vscode.Range(lineIndex, 0, lineIndex, 0),
        renderOptions: {
          before: {
            contentText: `${author} ${age.padStart(4, " ")} `,
            color: new vscode.ThemeColor("editorCodeLens.foreground"),
            fontStyle: "normal"
          }
        }
      });
      if (heatEnabled) {
        const bucket = entry.uncommitted ? 0 : heatBucket(entry.timestamp, newest, oldest);
        heats[bucket].push({ range: new vscode.Range(lineIndex, 0, lineIndex, 0) });
      }
    }
    editor.setDecorations(this.textType, texts);
    this.heatTypes.forEach((type, bucket) => editor.setDecorations(type, heats[bucket]));
  }

  dispose(): void {
    this.textType.dispose();
    for (const type of this.heatTypes) type.dispose();
    for (const d of this.disposables) d.dispose();
  }
}

function displayAuthor(entry: BlameLine): string {
  if (entry.uncommitted) return "You";
  return entry.author.length > 18 ? entry.author.slice(0, 17) + "…" : entry.author;
}
