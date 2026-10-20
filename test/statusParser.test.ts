import assert from "node:assert/strict";
import test from "node:test";
import { parsePorcelainV2Status } from "../src/git/parsers/statusParser";

test("parses clean branch status", () => {
  const status = parsePorcelainV2Status(
    "# branch.oid abc123\0# branch.head main\0# branch.ab +2 -1\0"
  );
  assert.equal(status.branch, "main");
  assert.equal(status.head, "abc123");
  assert.equal(status.ahead, 2);
  assert.equal(status.behind, 1);
  assert.equal(status.isClean, true);
});

test("parses untracked files", () => {
  const status = parsePorcelainV2Status(
    "# branch.head main\0? new-file.ts\0"
  );
  assert.equal(status.entries.length, 1);
  assert.equal(status.entries[0].kind, "untracked");
  assert.equal(status.entries[0].path, "new-file.ts");
});
