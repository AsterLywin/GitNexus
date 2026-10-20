import { GitService } from "../../git/gitService";
import { CommitGraph } from "../../domain/graph";
import { CommitGraphLayout } from "./graphLayout";

export class GraphService {
  private readonly layout = new CommitGraphLayout();

  constructor(private readonly git: GitService) {}

  async build(root: string, limit = 500): Promise<CommitGraph> {
    const commits = await this.git.log(root, limit);
    return this.layout.build(commits);
  }
}
