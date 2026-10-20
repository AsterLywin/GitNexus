import { MutationCoordinator } from "../../app/mutationCoordinator";
import { RepositoryOperationDetector } from "../../git/repositoryOperationDetector";

export class RebaseService {
  constructor(
    private readonly coordinator: MutationCoordinator,
    private readonly detector: RepositoryOperationDetector
  ) {}

  async start(root: string, upstream: string, interactive = false): Promise<void> {
    await this.coordinator.run({
      rootUri: root,
      operation: "rebase",
      args: ["rebase", ...(interactive ? ["-i"] : []), upstream]
    });
  }

  async action(root: string, action: "continue" | "skip" | "abort"): Promise<void> {
    await this.coordinator.run({
      rootUri: root,
      operation: "rebase",
      args: ["rebase", `--${action}`]
    });
  }

  async status(root: string) {
    return this.detector.detect(root);
  }
}
