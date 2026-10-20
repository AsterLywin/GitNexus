import { Worktree, WorktreeService } from "./worktreeService";

export class WorktreeManager {
  constructor(private readonly service: WorktreeService) {}

  async refresh(root: string): Promise<Worktree[]> {
    return this.service.list(root);
  }

  async create(root: string, path: string, ref?: string): Promise<Worktree[]> {
    await this.service.add(root, path, ref);
    return this.service.list(root);
  }

  async remove(root: string, path: string, force = false): Promise<Worktree[]> {
    await this.service.remove(root, path, force);
    return this.service.list(root);
  }
}
