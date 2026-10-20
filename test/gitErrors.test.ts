import assert from "node:assert/strict";
import test from "node:test";
import { GitError, classifyGitFailure, gitErrorFromFailure } from "../src/git/errors";

test("classifies common git failures into spec error codes", () => {
  assert.equal(classifyGitFailure("fatal: not a git repository (or any of the parent directories): .git", 128), "NOT_A_REPOSITORY");
  assert.equal(classifyGitFailure("fatal: Unable to create '/repo/.git/index.lock': File exists.", 128), "LOCKED");
  assert.equal(classifyGitFailure("Permission denied (publickey).\r\nfatal: Could not read from remote repository.", 128), "AUTH_REQUIRED");
  assert.equal(classifyGitFailure("fatal: Authentication failed for 'https://example.com/r.git/'", 128), "AUTH_REQUIRED");
  assert.equal(classifyGitFailure("CONFLICT (content): Merge conflict in a.ts\nAutomatic merge failed; fix conflicts and then commit the result.", 1), "CONFLICT");
  assert.equal(classifyGitFailure("fatal: ambiguous argument 'nope': unknown revision or path not in the working tree.", 128), "INVALID_REVISION");
  assert.equal(classifyGitFailure("The current branch main has no upstream branch.", 1), "NO_UPSTREAM");
  assert.equal(classifyGitFailure("fatal: unable to access 'https://x/': Could not resolve host: x", 128), "NETWORK_ERROR");
  assert.equal(classifyGitFailure("error: gpg failed to sign the data\nfatal: failed to write commit object", 128), "SIGNING_FAILED");
  assert.equal(classifyGitFailure("error: rebase in progress; you have not concluded your merge", 1), "OPERATION_IN_PROGRESS");
  assert.equal(classifyGitFailure("something entirely unexpected", 1), "UNKNOWN");
});

test("gitErrorFromFailure carries code, recoverable flag and suggestions", () => {
  const error = gitErrorFromFailure({
    stderr: "fatal: Unable to create '/r/.git/index.lock': File exists.",
    exitCode: 128,
    operation: "status",
    repo: "/r"
  });
  assert.ok(error instanceof GitError);
  assert.equal(error.code, "LOCKED");
  assert.equal(error.exitCode, 128);
  assert.equal(error.operation, "status");
  assert.equal(error.recoverable, true);
  assert.ok(error.suggestedActions?.some(a => a.action === "remove-lock"));
});
