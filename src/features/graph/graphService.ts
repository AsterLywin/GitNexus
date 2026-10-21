import { GitService, LogOptions } from "../../git/gitService";
import { CommitGraph } from "../../domain/graph";
import { CommitGraphLayout } from "./graphLayout";

export class GraphService {
  private readonly layout = new CommitGraphLayout();

  constructor(private readonly git: GitService) {}

  async build(root: string, limit = 500, options: LogOptions = {}): Promise<CommitGraph> {
    const commits = await this.git.log(root, limit, options);
    return this.layout.build(commits);
  }
}
