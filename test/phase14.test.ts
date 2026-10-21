import assert from "node:assert/strict";
import test from "node:test";
import { CommitSummary } from "../src/domain/git";
import { CommitGraphLayout } from "../src/features/graph/graphLayout";
import { createRenderModel } from "../src/features/graph/graphModel";
import { renderGraphWindowSvg } from "../src/features/graph/graphRenderer";
import { GraphService } from "../src/features/graph/graphService";
import { GitService, LogOptions } from "../src/git/gitService";

function commits(count: number): CommitSummary[] {
  const list: CommitSummary[] = [];
  for (let i = count; i >= 1; i--) {
    list.push({
      id: `c${i}`,
      parents: i > 1 ? [`c${i - 1}`] : [],
      authorName: "Bench",
      authorEmail: "bench@example.com",
      authorTimestamp: 1767225600,
      committerName: "Bench",
      committerEmail: "bench@example.com",
      committerTimestamp: 1767225600,
      subject: `commit ${i}`
    });
  }
  return list;
}

test("phase 14: density changes graph row geometry", () => {
  const graph = new CommitGraphLayout().build(commits(50));
  const model = createRenderModel(graph, 44, 28);

  const heightOf = (svg: string) => Number(/height="(\d+)"/.exec(svg)?.[1] ?? 0);
  const comfortable = renderGraphWindowSvg(model, 0, 10);
  const compact = renderGraphWindowSvg(model, 0, 10, undefined, {}, 30);

  // Same window (22 rows incl. overscan): 22*44 vs 22*30.
  assert.equal(heightOf(comfortable.svg), 22 * 44);
  assert.equal(heightOf(compact.svg), 22 * 30);
  assert.ok(compact.svg.includes('data-id="c50"'), "compact window still renders its rows");
});

test("phase 14: GraphService forwards log options (branch filter)", async () => {
  const seen: LogOptions[] = [];
  const stub = {
    log: async (_root: string, _limit: number, options: LogOptions = {}) => {
      seen.push(options);
      return commits(3);
    }
  };
  const service = new GraphService(stub as unknown as GitService);

  const allRefs = await service.build("/repo", 500, { allRefs: true });
  assert.equal(allRefs.nodes.length, 3);
  assert.deepEqual(seen[0], { allRefs: true });

  await service.build("/repo", 500);
  assert.deepEqual(seen[1], {}, "default build keeps HEAD-only history");
});
