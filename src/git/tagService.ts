import { GitProcessExecutor } from "./processExecutor";

export interface GitTag {
  name: string;
  objectId: string;
  /** Target commit the tag ultimately points at (peeled for annotated tags). */
  targetId: string;
  annotated: boolean;
}

export function parseTagList(raw: string): GitTag[] {
  return raw.split(/\r?\n/).filter(Boolean).map(line => {
    const [name, objectId, targetId, type] = line.split("\x1f");
    return {
      name,
      objectId,
      targetId: targetId || objectId,
      annotated: type === "tag"
    };
  });
}

/** Typed tag operations (GIT_ENGINE_SPEC §9, §12). Mutations are raw Git calls;
 * routing them through the MutationCoordinator is Phase 2 work. */
export class TagService {
  constructor(
    private readonly executor: GitProcessExecutor,
    private readonly timeoutMs = 30000
  ) {}

  async list(root: string): Promise<GitTag[]> {
    const result = await this.executor.exec(
      ["for-each-ref", "--format=%(refname:short)\x1f%(objectname)\x1f%(*objectname)\x1f%(objecttype)", "refs/tags"],
      { cwd: root, timeoutMs: this.timeoutMs }
    );
    return parseTagList(result.stdout);
  }

  async create(root: string, name: string, target = "HEAD", message?: string): Promise<void> {
    const args = message
      ? ["tag", "-a", name, "-m", message, target]
      : ["tag", name, target];
    await this.executor.exec(args, { cwd: root, timeoutMs: this.timeoutMs });
  }

  async delete(root: string, name: string): Promise<void> {
    await this.executor.exec(["tag", "-d", name], { cwd: root, timeoutMs: this.timeoutMs });
  }
}
