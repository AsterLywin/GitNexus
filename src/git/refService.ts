import { GitProcessExecutor } from "./processExecutor";
import { GitRef, RefSnapshot } from "../domain/ref";

export class RefService {
  constructor(
    private readonly executor: GitProcessExecutor,
    private readonly timeoutMs = 30000
  ) {}

  async list(root: string): Promise<RefSnapshot> {
    const branches = await this.executor.exec(
      ["for-each-ref", "--format=%(refname)%x1f%(refname:short)%x1f%(objectname)%x1f%(upstream:short)%x1f%(HEAD)", "refs/heads"],
      { cwd: root, timeoutMs: this.timeoutMs }
    );
    const remotes = await this.executor.exec(
      ["for-each-ref", "--format=%(refname)%x1f%(refname:short)%x1f%(objectname)", "refs/remotes"],
      { cwd: root, timeoutMs: this.timeoutMs }
    );
    const tags = await this.executor.exec(
      ["for-each-ref", "--format=%(refname)%x1f%(refname:short)%x1f%(objectname)", "refs/tags"],
      { cwd: root, timeoutMs: this.timeoutMs }
    );

    const branchRefs = branches.stdout.split(/\r?\n/).filter(Boolean).map(line => {
      const [name, shortName, objectId, upstream, head] = line.split("\x1f");
      return {
        name, shortName, objectId,
        kind: "localBranch" as const,
        upstream: upstream || undefined,
        isCurrent: head === "*"
      };
    });

    const remoteRefs = remotes.stdout.split(/\r?\n/).filter(Boolean).map(line => {
      const [name, shortName, objectId] = line.split("\x1f");
      return {
        name, shortName, objectId,
        kind: "remoteBranch" as const
      };
    });

    const tagRefs = tags.stdout.split(/\r?\n/).filter(Boolean).map(line => {
      const [name, shortName, objectId] = line.split("\x1f");
      return {
        name, shortName, objectId,
        kind: "tag" as const
      };
    });

    return {
      refs: [...branchRefs, ...remoteRefs, ...tagRefs],
      branches: branchRefs,
      remotes: remoteRefs,
      tags: tagRefs
    };
  }
}
