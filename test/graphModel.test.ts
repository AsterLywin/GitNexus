import assert from "node:assert/strict";
import test from "node:test";
import { createRenderModel, getRenderWindow } from "../src/features/graph/graphModel";

test("creates graph render rows and virtual window", () => {
  const graph = {
    nodes: [
      { id:"a", parents:["b"], lane:0 },
      { id:"b", parents:["c"], lane:1 },
      { id:"c", parents:[], lane:0 }
    ],
    edges: [
      { from:"a", to:"b" },
      { from:"b", to:"c" }
    ]
  } as any;

  const model = createRenderModel(graph);
  const window = getRenderWindow(model, 1, 2, 0);

  assert.equal(model.nodes[1].row, 1);
  assert.equal(window.nodes.length, 1);
  assert.equal(window.edges.length, 2);
});
