/**
 * Secret-safe operation observability (GIT_ENGINE_SPEC §26).
 *
 * Only the command *family* (the Git subcommand), repository, duration and
 * outcome are recorded — never full argument lists, environment values, or
 * credentials, any of which can carry secrets.
 */

import { GitErrorCode } from "./errors";

export interface OperationRecord {
  operationId: number;
  repo: string;
  family: string;
  durationMs: number;
  ok: boolean;
  errorCode?: GitErrorCode;
}

export interface OperationLog {
  record(record: Omit<OperationRecord, "operationId">): void;
}

export class InMemoryOperationLog implements OperationLog {
  private nextId = 1;
  readonly records: OperationRecord[] = [];

  constructor(private readonly capacity = 500) {}

  record(record: Omit<OperationRecord, "operationId">): void {
    this.records.push({ ...record, operationId: this.nextId++ });
    if (this.records.length > this.capacity) {
      this.records.splice(0, this.records.length - this.capacity);
    }
  }
}

/** The Git subcommand is the only argument ever safe to log. */
export function commandFamily(args: readonly string[]): string {
  return args[0] ?? "git";
}
