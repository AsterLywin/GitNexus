import { GitProcessExecutor } from "../../git/processExecutor";

export type RebaseAction = "pick" | "reword" | "edit" | "squash" | "fixup" | "drop";

export interface RebaseTodo {
  action: RebaseAction;
  commit: string;
  subject: string;
}

export class RebaseEditor {
  constructor(
    private readonly executor: GitProcessExecutor,
    private readonly timeoutMs = 30000
  ) {}

  async readTodo(root: string): Promise<RebaseTodo[]> {
    const result = await this.executor.exec(
      ["rebase", "--show-current-patch"],
      { cwd: root, timeoutMs: this.timeoutMs }
    ).catch(() => undefined);

    if (!result) return [];
    return parseTodo(result.stdout);
  }

  async start(root: string, upstream: string, todo: RebaseTodo[]): Promise<void> {
    // The real interactive editor is intentionally driven by a generated sequence
    // editor in the application layer; this service validates the plan before launch.
    validateTodo(todo);
    await this.executor.exec(
      ["rebase", "-i", upstream],
      { cwd: root, timeoutMs: this.timeoutMs }
    );
  }
}

function parseTodo(raw: string): RebaseTodo[] {
  return raw.split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => /^(pick|reword|edit|squash|fixup|drop)\s+[0-9a-f]+/.test(line))
    .map(line => {
      const [action, commit, ...rest] = line.split(/\s+/);
      return {
        action: action as RebaseAction,
        commit,
        subject: rest.join(" ")
      };
    });
}

function validateTodo(todo: RebaseTodo[]): void {
  const allowed = new Set(["pick", "reword", "edit", "squash", "fixup", "drop"]);
  if (!todo.length) throw new Error("Rebase plan is empty.");
  for (const item of todo) {
    if (!allowed.has(item.action)) throw new Error(`Invalid rebase action: ${item.action}`);
    if (!/^[0-9a-f]{7,64}$/.test(item.commit)) throw new Error(`Invalid commit id: ${item.commit}`);
  }
}
