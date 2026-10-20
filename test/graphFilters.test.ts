import assert from "node:assert/strict";
import test from "node:test";
import { filterGraphNodes } from "../src/features/graph/graphFilters";

test("filters graph nodes by text and merge visibility", () => {
  const nodes = [
    { id:"abcdef1", label:"fix login", author:"Alice", parents:["x"], lane:0, row:0, laneX:0 },
    { id:"abcdef2", label:"merge branch", author:"Bob", parents:["x","y"], lane:1, row:1, laneX:28 }
  ] as any;

  assert.equal(filterGraphNodes(nodes, { text:"login" }).length, 1);
  assert.equal(filterGraphNodes(nodes, { hideMerges:true }).length, 1);
});
