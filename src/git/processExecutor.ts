import { spawn } from "node:child_process";
import { GitError, gitErrorFromFailure } from "./errors";
import { OperationLog, commandFamily } from "./operationLog";

export interface GitExecOptions {
  cwd: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
}

export interface GitExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface GitProcessExecutor {
  exec(args: readonly string[], options: GitExecOptions): Promise<GitExecResult>;
}

export class NodeGitProcessExecutor implements GitProcessExecutor {
  constructor(
    private readonly gitPath = "git",
    private readonly operationLog?: OperationLog
  ) {}

  exec(args: readonly string[], options: GitExecOptions): Promise<GitExecResult> {
    const startedAt = Date.now();
    const family = commandFamily(args);
    const log = (ok: boolean, errorCode?: GitError["code"]) => {
      this.operationLog?.record({
        repo: options.cwd,
        family,
        durationMs: Date.now() - startedAt,
        ok,
        errorCode
      });
    };

    return new Promise((resolve, reject) => {
      const child = spawn(this.gitPath, [...args], {
        cwd: options.cwd,
        env: options.env ? { ...process.env, ...options.env } : undefined,
        stdio: ["ignore", "pipe", "pipe"]
      });

      let stdout = "";
      let stderr = "";
      let settled = false;

      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        fn();
      };

      const timeout = setTimeout(() => {
        child.kill();
        log(false, "TIMEOUT");
        finish(() => reject(new GitError(`Git command timed out: git ${family}`, {
          code: "TIMEOUT",
          operation: family,
          repo: options.cwd
        })));
      }, options.timeoutMs ?? 30000);

      const abort = () => {
        child.kill();
        log(false, "CANCELLED");
        finish(() => reject(new GitError(`Git command cancelled: git ${family}`, {
          code: "CANCELLED",
          operation: family,
          repo: options.cwd
        })));
      };

      if (options.signal) {
        if (options.signal.aborted) abort();
        else options.signal.addEventListener("abort", abort, { once: true });
      }

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", chunk => stdout += chunk);
      child.stderr.on("data", chunk => stderr += chunk);

      child.on("error", error => {
        clearTimeout(timeout);
        const notFound = (error as NodeJS.ErrnoException).code === "ENOENT";
        const code = notFound ? "GIT_NOT_FOUND" as const : "UNKNOWN" as const;
        log(false, code);
        finish(() => reject(new GitError(
          notFound ? `Git executable not found: ${this.gitPath}` : error.message,
          { code, operation: family, repo: options.cwd }
        )));
      });

      child.on("close", exitCode => {
        clearTimeout(timeout);
        finish(() => {
          if (exitCode !== 0) {
            const error = gitErrorFromFailure({
              stderr,
              exitCode: exitCode ?? undefined,
              operation: family,
              repo: options.cwd
            });
            log(false, error.code);
            reject(error);
            return;
          }
          log(true);
          resolve({ stdout, stderr, exitCode: exitCode ?? 0 });
        });
      });
    });
  }
}
