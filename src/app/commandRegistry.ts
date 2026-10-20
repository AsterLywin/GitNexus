import * as vscode from "vscode";

export class CommandRegistry {
  private readonly disposables: vscode.Disposable[] = [];

  register(command: string, handler: (...args: any[]) => unknown): void {
    this.disposables.push(vscode.commands.registerCommand(command, handler));
  }

  dispose(): void {
    while (this.disposables.length) this.disposables.pop()?.dispose();
  }
}
