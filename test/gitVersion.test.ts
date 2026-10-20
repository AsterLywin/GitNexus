import assert from "node:assert/strict";
import test from "node:test";
import {
  compareGitVersion,
  detectCapabilities,
  isSupportedGitVersion,
  parseGitVersion
} from "../src/git/version";

test("parses git versions including platform suffixes", () => {
  const v = parseGitVersion("git version 2.45.2.windows.1");
  assert.ok(v);
  assert.deepEqual([v.major, v.minor, v.patch], [2, 45, 2]);
  assert.equal(v.suffix, ".windows.1");
  assert.equal(parseGitVersion("git version 2.11.0")?.patch, 0);
  assert.equal(parseGitVersion("not git output"), undefined);
});

test("compares versions and detects capabilities by threshold", () => {
  const old = parseGitVersion("git version 2.10.0")!;
  const modern = parseGitVersion("git version 2.45.0")!;
  assert.ok(compareGitVersion(old, modern) < 0);
  assert.equal(isSupportedGitVersion(old), false);
  assert.equal(isSupportedGitVersion(modern), true);

  const oldCaps = detectCapabilities(old);
  assert.equal(oldCaps.porcelainV2, false);
  assert.equal(oldCaps.worktrees, true);

  const caps = detectCapabilities(modern);
  assert.equal(caps.porcelainV2, true);
  assert.equal(caps.pathspecFromFile, true);
  assert.equal(caps.sparseCheckout, true);
  assert.equal(caps.partialClone, true);
  assert.equal(caps.commitGraph, true);
});
