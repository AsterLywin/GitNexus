/**
 * Operation journal (REPOSITORY_STATE_MODEL §32) and crash recovery (§31).
 *
 * The journal is for diagnostics and UI recovery, not a replacement for Git
 * state. Entries still marked "running" when a journal is loaded belonged
 * to a previous, terminated session: they are surfaced as "interrupted"
 * and are NEVER continued automatically.
 */

export type JournalStatus = "running" | "success" | "failed" | "cancelled" | "interrupted";

export interface OperationJournalEntry {
  operationId: string;
  type: string;
  repo: string;
  startedAt: number;
  finishedAt?: number;
  status: JournalStatus;
  preGeneration: number;
  postGeneration?: number;
}

export class OperationJournal {
  private entries: OperationJournalEntry[];
  private seq = 0;
  private readonly interruptedOnLoad: OperationJournalEntry[];

  constructor(
    private readonly onChange?: () => void,
    initial: OperationJournalEntry[] = []
  ) {
    this.entries = initial.slice(-100).map(e => ({ ...e }));
    this.interruptedOnLoad = [];
    for (const entry of this.entries) {
      if (entry.status === "running") {
        entry.status = "interrupted";
        this.interruptedOnLoad.push(entry);
      }
      const n = Number(entry.operationId.split(":").pop());
      if (Number.isFinite(n) && n > this.seq) this.seq = n;
    }
  }

  begin(input: { type: string; repo: string; preGeneration: number }): string {
    const operationId = `op:${++this.seq}`;
    this.entries.push({
      operationId,
      type: input.type,
      repo: input.repo,
      startedAt: Date.now(),
      status: "running",
      preGeneration: input.preGeneration
    });
    this.trim();
    this.onChange?.();
    return operationId;
  }

  complete(operationId: string, postGeneration?: number): void {
    this.finish(operationId, "success", postGeneration);
  }

  fail(operationId: string): void {
    this.finish(operationId, "failed");
  }

  cancel(operationId: string): void {
    this.finish(operationId, "cancelled");
  }

  /** Operations that were running when the previous session ended (§31). */
  interrupted(): OperationJournalEntry[] {
    return [...this.interruptedOnLoad];
  }

  list(repo?: string): OperationJournalEntry[] {
    return this.entries
      .filter(e => !repo || e.repo === repo)
      .map(e => ({ ...e }));
  }

  serialize(): OperationJournalEntry[] {
    return this.list();
  }

  private finish(operationId: string, status: JournalStatus, postGeneration?: number): void {
    const entry = this.entries.find(e => e.operationId === operationId);
    if (!entry || entry.status !== "running") return;
    entry.status = status;
    entry.finishedAt = Date.now();
    if (postGeneration !== undefined) entry.postGeneration = postGeneration;
    this.onChange?.();
  }

  private trim(): void {
    if (this.entries.length > 100) {
      this.entries = this.entries.slice(-100);
    }
  }
}
