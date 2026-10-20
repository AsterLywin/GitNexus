import assert from "node:assert/strict";
import test from "node:test";
import { parseCommitSearch } from "../src/features/search/searchParser";

test("parses Git-style search qualifiers", () => {
  const q = parseCommitSearch('author:Alice message:"fix login" file:src/auth.ts after:2026-01-01');
  assert.equal(q.author, "Alice");
  assert.equal(q.text, "fix login");
  assert.equal(q.file, "src/auth.ts");
  assert.equal(q.after, "2026-01-01");
  assert.equal(q.allRefs, true);
});
