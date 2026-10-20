/**
 * Git backend contract (GIT_ENGINE_SPEC §3, §21).
 *
 * The initial backend is the installed Git executable. Higher layers depend
 * on this interface, not on CLI details, so libgit2 / remote backends can
 * replace it later. `stream()` exists so large histories and diffs are
 * consumable incrementally; consumers may stop early and the process is
 * terminated.
 */

import { spawn } from "node:child_process";
import { CommitSummary } from "../domain/git";
import { GitError, gitErrorFromFailure } from "./errors";
import { OperationLog, commandFamily } from "./operationLog";
import { parseLog } from "./parsers/logParser";
import { GitVersion, parseGitVersion } from "./version";

export interface GitRequest {
  args: readonly string[];
  cwd: string;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface GitRawResult {
  exitCode: number;
  stdout: Uint8Array;
  stderr: Uint8Array;
  durationMs: number;
  cancelled: boolean;
}

export interface GitChunk {
  stdout?: Uint8Array;
  stderr?: Uint8Array;
}

export interface GitBackend {
  execute(request: GitRequest): Promise<GitRawResult>;
  stream(request: GitRequest): AsyncIterable<GitChunk>;
  getVersion(): Promise<GitVersion>;
  dispose(): void;
}

export class NodeGitBackend implements GitBackend {
  private versionCache?: Promise<GitVersion>;

  constructor(
    private readonly gitPath = "git",
    private readonly operationLog?: OperationLog
  ) {}

  async execute(request: GitRequest): Promise<GitRawResult> {
    const startedAt = Date.now();
    const stdoutParts: Uint8Array[] = [];
    const stderrParts: Uint8Array[] = [];
    let cancelled = false;

    try {
      for await (const chunk of this.stream(request)) {
        if (chunk.stdout) stdoutParts.push(chunk.stdout);
        if (chunk.stderr) stderrParts.push(chunk.stderr);
      }
    } catch (error) {
      if (error instanceof GitError && error.code === "CANCELLED") cancelled = true;
      else throw error;
    }

    return {
      exitCode: cancelled ? -1 : 0,
      stdout: concatBytes(stdoutParts),
      stderr: concatBytes(stderrParts),
      durationMs: Date.now() - startedAt,
      cancelled
    };
  }

  async *stream(request: GitRequest): AsyncIterable<GitChunk> {
    const startedAt = Date.now();
    const family = commandFamily(request.args);
    const child = spawn(this.gitPath, [...request.args], {
      cwd: request.cwd,
      env: request.env ? { ...process.env, ...cleanEnv(request.env) } : undefined,
      stdio: ["ignore", "pipe", "pipe"]
    });

    const queue: GitChunk[] = [];
    let notify: (() => void) | undefined;
    let done = false;
    let failure: Error | undefined;
    let stderrText = "";
    let aborted = false;
    let timedOut = false;

    const wake = () => { notify?.(); notify = undefined; };
    const onAbort = () => { aborted = true; child.kill(); };
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, request.timeoutMs ?? 30000);
    if (request.signal) {
      if (request.signal.aborted) onAbort();
      else request.signal.addEventListener("abort", onAbort, { once: true });
    }

    child.stdout.on("data", (chunk: Buffer) => {
      queue.push({ stdout: new Uint8Array(chunk) });
      wake();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrText += chunk.toString("utf8");
      queue.push({ stderr: new Uint8Array(chunk) });
      wake();
    });
    child.on("error", error => {
      const notFound = (error as NodeJS.ErrnoException).code === "ENOENT";
      failure = new GitError(
        notFound ? `Git executable not found: ${this.gitPath}` : error.message,
        { code: notFound ? "GIT_NOT_FOUND" : "UNKNOWN", operation: family, repo: request.cwd }
      );
      done = true;
      wake();
    });
    child.on("close", exitCode => {
      if (aborted) {
        failure = new GitError(`Git command cancelled: git ${family}`, {
          code: "CANCELLED", operation: family, repo: request.cwd
        });
      } else if (timedOut) {
        failure = new GitError(`Git command timed out: git ${family}`, {
          code: "TIMEOUT", operation: family, repo: request.cwd
        });
      } else if (exitCode !== 0) {
        failure = gitErrorFromFailure({
          stderr: stderrText,
          exitCode: exitCode ?? undefined,
          operation: family,
          repo: request.cwd
        });
      }
      done = true;
      wake();
    });

    try {
      while (!done || queue.length > 0) {
        if (queue.length > 0) {
          yield queue.shift()!;
        } else {
          await new Promise<void>(resolve => { notify = resolve; });
        }
      }
    } finally {
      clearTimeout(timer);
      request.signal?.removeEventListener("abort", onAbort);
      if (!done) child.kill();
      this.operationLog?.record({
        repo: request.cwd,
        family,
        durationMs: Date.now() - startedAt,
        ok: !failure,
        errorCode: failure instanceof GitError ? failure.code : undefined
      });
    }

    if (failure) throw failure;
  }

  getVersion(): Promise<GitVersion> {
    this.versionCache ??= (async () => {
      let text = "";
      for await (const chunk of this.stream({ args: ["--version"], cwd: process.cwd() })) {
        if (chunk.stdout) text += new TextDecoder().decode(chunk.stdout);
      }
      const version = parseGitVersion(text);
      if (!version) {
        throw new GitError(`Could not parse Git version from: ${text.trim()}`, {
          code: "UNKNOWN",
          operation: "--version"
        });
      }
      return version;
    })();
    return this.versionCache;
  }

  dispose(): void {
    this.versionCache = undefined;
  }
}

/**
 * Stream commit records from a `git log` invocation: buffers raw output,
 * splits on the record separator used by the shared log format, and yields
 * parsed commits as they become available.
 */
export async function* streamCommits(
  backend: GitBackend,
  request: GitRequest
): AsyncIterable<CommitSummary> {
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  for await (const chunk of backend.stream(request)) {
    if (!chunk.stdout) continue;
    buffer += decoder.decode(chunk.stdout, { stream: true });
    const records = buffer.split("\x1e");
    buffer = records.pop() ?? "";
    for (const record of records) {
      if (record.trim()) yield* parseLog(record + "\x1e");
    }
  }
  if (buffer.trim()) yield* parseLog(buffer);
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function cleanEnv(env: Record<string, string | undefined>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) result[key] = value;
  }
  return result;
}
