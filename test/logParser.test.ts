import assert from "node:assert/strict";
import test from "node:test";
import { parseLog } from "../src/git/parsers/logParser";

test("parses a commit record", () => {
  const sep = "\x1f";
  const record = "\x1e" + [
    "abc",
    "def ghi",
    "Alice",
    "alice@example.com",
    "100",
    "Alice",
    "alice@example.com",
    "101",
    "Initial commit",
    "body"
  ].join(sep) + "\x1e";

  const commits = parseLog(record);
  assert.equal(commits.length, 1);
  assert.equal(commits[0].id, "abc");
  assert.deepEqual(commits[0].parents, ["def", "ghi"]);
  assert.equal(commits[0].subject, "Initial commit");
});
