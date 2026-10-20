/**
 * Normalized Git error model (GIT_ENGINE_SPEC §6).
 *
 * Every failure that crosses the domain boundary is a GitError carrying one
 * of the spec's stable codes, whether it is recoverable, and suggested
 * recovery actions. Raw stderr is preserved for diagnostics but must never
 * be logged with secrets — callers pass it through redaction first.
 */

export type GitErrorCode =
  | "NOT_A_REPOSITORY"
  | "GIT_NOT_FOUND"
  | "UNSUPPORTED_GIT_VERSION"
  | "AUTH_REQUIRED"
  | "PERMISSION_DENIED"
  | "LOCKED"
  | "CONFLICT"
  | "INVALID_REVISION"
  | "OPERATION_IN_PROGRESS"
  | "NO_UPSTREAM"
  | "NETWORK_ERROR"
  | "HOOK_FAILED"
  | "SIGNING_FAILED"
  | "CANCELLED"
  | "TIMEOUT"
  | "UNKNOWN";

export interface GitRecoveryAction {
  /** Machine-readable action kind, e.g. "retry", "sign-in", "remove-lock". */
  action: string;
  /** Short human-readable label for UI presentation. */
  label: string;
}

export interface GitErrorOptions {
  code: GitErrorCode;
  exitCode?: number;
  stderr?: string;
  operation?: string;
  repo?: string;
  recoverable?: boolean;
  suggestedActions?: GitRecoveryAction[];
}

const RECOVERABLE: Record<GitErrorCode, boolean> = {
  NOT_A_REPOSITORY: false,
  GIT_NOT_FOUND: false,
  UNSUPPORTED_GIT_VERSION: false,
  AUTH_REQUIRED: true,
  PERMISSION_DENIED: true,
  LOCKED: true,
  CONFLICT: true,
  INVALID_REVISION: true,
  OPERATION_IN_PROGRESS: true,
  NO_UPSTREAM: true,
  NETWORK_ERROR: true,
  HOOK_FAILED: true,
  SIGNING_FAILED: true,
  CANCELLED: true,
  TIMEOUT: true,
  UNKNOWN: true
};

const SUGGESTIONS: Partial<Record<GitErrorCode, GitRecoveryAction[]>> = {
  AUTH_REQUIRED: [{ action: "sign-in", label: "Sign in to the remote host" }],
  LOCKED: [
    { action: "wait", label: "Wait for the other Git process to finish" },
    { action: "remove-lock", label: "Remove the stale index.lock if no Git process is running" }
  ],
  CONFLICT: [{ action: "open-conflicts", label: "Open the conflict resolver" }],
  OPERATION_IN_PROGRESS: [
    { action: "continue-operation", label: "Continue the in-progress operation" },
    { action: "abort-operation", label: "Abort the in-progress operation" }
  ],
  NO_UPSTREAM: [{ action: "set-upstream", label: "Set an upstream branch" }],
  NETWORK_ERROR: [{ action: "retry", label: "Check the connection and retry" }],
  TIMEOUT: [{ action: "retry", label: "Retry the operation" }],
  GIT_NOT_FOUND: [{ action: "configure-git-path", label: "Check the configured Git executable path" }]
};

export class GitError extends Error {
  public readonly code: GitErrorCode;
  public readonly exitCode?: number;
  public readonly stderr?: string;
  public readonly operation?: string;
  public readonly repo?: string;
  public readonly recoverable: boolean;
  public readonly suggestedActions?: GitRecoveryAction[];

  constructor(message: string, options: GitErrorOptions) {
    super(message);
    this.name = "GitError";
    this.code = options.code;
    this.exitCode = options.exitCode;
    this.stderr = options.stderr;
    this.operation = options.operation;
    this.repo = options.repo;
    this.recoverable = options.recoverable ?? RECOVERABLE[options.code];
    this.suggestedActions = options.suggestedActions ?? SUGGESTIONS[options.code];
  }
}

interface ErrorPattern {
  code: GitErrorCode;
  pattern: RegExp;
}

// Order matters: the first matching pattern wins, so specific causes
// (auth over publickey, locks, signing) precede generic ones.
const STDERR_PATTERNS: ErrorPattern[] = [
  { code: "NOT_A_REPOSITORY", pattern: /not a git repository/i },
  { code: "AUTH_REQUIRED", pattern: /authentication failed|permission denied \(publickey|fatal: could not read username|could not read password|terminal prompts disabled|invalid username or password/i },
  { code: "NO_UPSTREAM", pattern: /no upstream branch|has no upstream branch|no upstream configured/i },
  { code: "LOCKED", pattern: /unable to create .*\.lock|another git process seems to be running|file exists\.?\s*$|index\.lock/i },
  { code: "SIGNING_FAILED", pattern: /gpg failed to sign|signing failed|failed to sign the data|error: gpg/i },
  { code: "HOOK_FAILED", pattern: /hook (failed|declined|error)|\.git[\\/]hooks[\\/].*(failed|error)/i },
  { code: "OPERATION_IN_PROGRESS", pattern: /operation in progress|in the middle of|you have not concluded your (merge|cherry-pick|revert)|rebase (is already|in progress)|first, please resolve|you must resolve your current index first/i },
  { code: "CONFLICT", pattern: /\bCONFLICT\b|needs merge|fix conflicts|automatic merge failed/i },
  { code: "INVALID_REVISION", pattern: /unknown revision|bad revision|invalid object name|ambiguous argument|unknown object|not a valid object name|invalid reference/i },
  { code: "NETWORK_ERROR", pattern: /could not resolve host|connection (refused|reset|timed out)|network is unreachable|failed to connect|could not read from remote repository|error in the pull function|ssl connect error/i },
  { code: "PERMISSION_DENIED", pattern: /permission denied|operation not permitted|insufficient permission/i }
];

/** Classify a failed Git invocation from its stderr and exit code. */
export function classifyGitFailure(stderr: string, exitCode?: number): GitErrorCode {
  for (const { code, pattern } of STDERR_PATTERNS) {
    if (pattern.test(stderr)) return code;
  }
  return "UNKNOWN";
}

/** Build a normalized GitError for a failed Git invocation. */
export function gitErrorFromFailure(input: {
  stderr: string;
  exitCode?: number;
  operation?: string;
  repo?: string;
  message?: string;
}): GitError {
  const code = classifyGitFailure(input.stderr, input.exitCode);
  const firstLine = input.stderr.split(/\r?\n/).map(l => l.trim()).find(Boolean);
  return new GitError(
    input.message ?? firstLine ?? `Git operation failed with exit code ${input.exitCode ?? "unknown"}`,
    {
      code,
      exitCode: input.exitCode,
      stderr: input.stderr || undefined,
      operation: input.operation,
      repo: input.repo
    }
  );
}
