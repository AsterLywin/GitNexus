import { spawn } from "node:child_process";
import { GitError } from "./errors";

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
  constructor(private readonly gitPath = "git") {}

  exec(args: readonly string[], options: GitExecOptions): Promise<GitExecResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.gitPath, [...args], {
        cwd: options.cwd,
        env: options.env,
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
        finish(() => reject(new GitError(`Git command timed out: git ${args.join(" ")}`, {
          code: "GIT_TIMEOUT"
        })));
      }, options.timeoutMs ?? 30000);

      const abort = () => {
        child.kill();
        finish(() => reject(new GitError(`Git command cancelled: git ${args.join(" ")}`, {
          code: "GIT_CANCELLED"
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
        finish(() => reject(new GitError(error.message, { code: "GIT_PROCESS_ERROR" })));
      });

      child.on("close", exitCode => {
        clearTimeout(timeout);
        finish(() => {
          if (exitCode !== 0) {
            reject(new GitError(`Git exited with code ${exitCode}`, {
              code: "GIT_EXIT",
              exitCode: exitCode ?? undefined,
              stderr
            }));
            return;
          }
          resolve({ stdout, stderr, exitCode: exitCode ?? 0 });
        });
      });
    });
  }
}
