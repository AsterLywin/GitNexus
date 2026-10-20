export class GitError extends Error {
  public readonly code: string;
  public readonly exitCode?: number;
  public readonly stderr?: string;

  constructor(message: string, options: {
    code: string;
    exitCode?: number;
    stderr?: string;
  }) {
    super(message);
    this.name = "GitError";
    this.code = options.code;
    this.exitCode = options.exitCode;
    this.stderr = options.stderr;
  }
}
