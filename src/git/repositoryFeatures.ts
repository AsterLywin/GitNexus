import { FULL_FEATURES, RepositoryFeatures } from "../domain/state";
import { GitProcessExecutor } from "./processExecutor";

export interface RepositoryEnvironment {
  features: RepositoryFeatures;
  /** The repository tracks Git LFS files (git-lfs present and listing files). */
  lfs: boolean;
}

const NO_ENV: RepositoryEnvironment = { features: FULL_FEATURES, lfs: false };

/**
 * Detect repository feature limitations (REPOSITORY_STATE_MODEL §35) and
 * Git LFS usage. Every probe is independent and failure-tolerant: a probe
 * that cannot run simply reports "not present".
 */
export async function detectRepositoryEnvironment(
  executor: GitProcessExecutor,
  root: string
): Promise<RepositoryEnvironment> {
  const probe = async (args: string[]): Promise<string | undefined> => {
    try {
      const result = await executor.exec(args, { cwd: root, timeoutMs: 10000 });
      return result.stdout.trim();
    } catch {
      return undefined;
    }
  };

  const [shallow, promisor, sparseList, sparseIndexCfg, lfsFiles] = await Promise.all([
    probe(["rev-parse", "--is-shallow-repository"]),
    probe(["config", "--get-regexp", "^remote\\..*\\.promisor$"]),
    probe(["sparse-checkout", "list"]),
    probe(["config", "--get", "index.sparse"]),
    probe(["lfs", "ls-files"])
  ]);

  return {
    features: {
      shallow: shallow === "true",
      partialClone: Boolean(promisor),
      sparseCheckout: sparseList !== undefined && sparseList.length > 0,
      sparseIndex: sparseIndexCfg === "true"
    },
    lfs: lfsFiles !== undefined && lfsFiles.length > 0
  };
}

export { NO_ENV };
