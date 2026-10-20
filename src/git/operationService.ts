import { GitProcessExecutor } from "./processExecutor";
import {
  DetectedOperation,
  RepositoryOperationDetector
} from "./repositoryOperationDetector";

export type OperationKind = "merge" | "rebase" | "cherry-pick" | "revert";
export type OperationAction = "continue" | "skip" | "abort";

/**
 * Argument mapping for operation lifecycle actions. Returns undefined when
 * Git does not support the action for that operation (a merge cannot be
 * skipped). Continues run with GIT_EDITOR=true at the call site so Git
 * accepts the prepared commit message instead of opening an editor.
 */
export function operationArgs(kind: OperationKind, action: OperationAction): string[] | undefined {
  switch (kind) {
    case "merge":
      return action === "skip" ? undefined : ["merge", `--${action}`];
    case "rebase":
      return ["rebase", `--${action}`];
    case "cherry-pick":
      return ["cherry-pick", `--${action}`];
    case "revert":
      return ["revert", `--${action}`];
  }
}

/**
 * Lifecycle control for in-progress Git operations (merge, rebase,
 * cherry-pick, revert): continue / skip / abort against whatever the
 * operation detector finds in the repository. Execution itself is the
 * caller's job (the extension routes through the MutationCoordinator);
 * this service resolves *what* to run and validates support.
 */
export class OperationService {
  constructor(
    private readonly executor: GitProcessExecutor,
    private readonly detector: RepositoryOperationDetector
  ) {}

  async current(root: string): Promise<DetectedOperation> {
    return this.detector.detect(root);
  }

  /**
   * Resolve the argv + environment for a lifecycle action, or throw a
   * typed error when no operation is in progress or the action is not
   * supported for it.
   */
  async plan(root: string, action: OperationAction): Promise<{
    kind: OperationKind;
    args: string[];
    env: Record<string, string>;
  }> {
    const detected = await this.detector.detect(root);
    if (detected.phase === "idle" || !detected.operation) {
      throw new Error("No Git operation is in progress in this repository.");
    }
    const kind = detected.operation;
    const args = operationArgs(kind, action);
    if (!args) {
      throw new Error(
        `Cannot ${action} a ${kind}: Git does not support that action for this operation.` +
        (kind === "merge" && action === "skip"
          ? " Resolve the conflicts and continue, or abort the merge."
          : "")
      );
    }
    return {
      kind,
      args,
      env: action === "continue" ? { GIT_EDITOR: "true" } : {}
    };
  }

  /** Direct execution for non-extension callers (tests, scripts). */
  async run(root: string, action: OperationAction): Promise<OperationKind> {
    const plan = await this.plan(root, action);
    await this.executor.exec(plan.args, {
      cwd: root,
      timeoutMs: 120000,
      env: plan.env
    });
    return plan.kind;
  }
}
