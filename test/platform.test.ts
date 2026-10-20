import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { RepositorySnapshot } from "../src/domain/git";
import { AiContextStore, buildAiContextPackage } from "../src/features/ai/aiContext";
import { GitHubPullRequestProvider } from "../src/features/pr/githubProvider";
import { buildPrDecorations } from "../src/features/pr/prDecorations";
import { compareUrl, parseGitHubRemote } from "../src/features/pr/remoteInfo";
import { NodeGitProcessExecutor } from "../src/git/processExecutor";
import { detectRepositoryEnvironment } from "../src/git/repositoryFeatures";

const run = promisify(execFile);

test("parses every common GitHub remote form and rejects others", () => {
  const expected = { owner: "AsterLywin", repo: "GitNexus" };
  assert.deepEqual(parseGitHubRemote("git@github.com:AsterLywin/GitNexus.git"), expected);
  assert.deepEqual(parseGitHubRemote("git@github.com:AsterLywin/GitNexus"), expected);
  assert.deepEqual(parseGitHubRemote("https://github.com/AsterLywin/GitNexus.git"), expected);
  assert.deepEqual(parseGitHubRemote("https://github.com/AsterLywin/GitNexus/"), expected);
  assert.deepEqual(parseGitHubRemote("ssh://git@github.com/AsterLywin/GitNexus.git"), expected);
  assert.equal(parseGitHubRemote("https://gitlab.com/a/b.git"), undefined);
  assert.equal(parseGitHubRemote("/local/path/repo"), undefined);
  assert.equal(
    compareUrl(expected, "main", "feature/x"),
    "https://github.com/AsterLywin/GitNexus/compare/main...feature%2Fx?expand=1"
  );
});

function fakeFetch(routes: Record<string, unknown>) {
  return async (url: string) => {
    const path = String(url).replace("https://api.github.com", "");
    if (!(path in routes)) {
      return { ok: false, status: 404, text: async () => "not found", json: async () => ({}) };
    }
    return { ok: true, status: 200, text: async () => "", json: async () => routes[path] };
  };
}

test("GitHub adapter maps PRs and enriches branch PRs with CI + review status", async () => {
  const prJson = {
    id: 7, number: 12, title: "Add thing", state: "open", merged_at: null,
    html_url: "https://github.com/o/r/pull/12", user: { login: "aster" },
    head: { ref: "feature", sha: "abc123" }, base: { ref: "main" }
  };
  const provider = new GitHubPullRequestProvider({
    remote: { owner: "o", repo: "r" },
    getToken: async () => "token",
    fetchFn: fakeFetch({
      "/repos/o/r/pulls?state=open&per_page=50": [prJson],
      "/repos/o/r/pulls?state=open&head=o%3Afeature": [prJson],
      "/repos/o/r/commits/abc123/check-runs": {
        check_runs: [
          { status: "completed", conclusion: "success" },
          { status: "in_progress", conclusion: null }
        ]
      },
      "/repos/o/r/pulls/12/reviews": [{ user: { login: "rev" }, state: "APPROVED" }]
    }) as unknown as typeof fetch
  });

  const open = await provider.listOpen();
  assert.equal(open.length, 1);
  assert.equal(open[0].number, 12);
  assert.equal(open[0].headBranch, "feature");

  const enriched = await provider.forBranch("feature");
  assert.equal(enriched?.ciStatus, "pending");
  assert.equal(enriched?.reviewStatus, "approved");
  assert.equal(provider.createUrl("main", "feature"), "https://github.com/o/r/compare/main...feature?expand=1");

  const decorations = buildPrDecorations(open, {
    refs: [],
    branches: [{ name: "refs/heads/feature", shortName: "feature", objectId: "abc123", kind: "localBranch" } as never],
    remotes: [],
    tags: []
  });
  assert.equal(decorations.length, 1);
  assert.equal(decorations[0].commitId, "abc123");
  assert.equal(decorations[0].labels[0].kind, "pr");
});

function snapshotFixture(): RepositorySnapshot {
  return {
    identity: { rootUri: "/r", gitDir: "/r/.git", commonDir: "/r/.git", isBare: false },
    head: { commit: "aaa111", ref: "main", detached: false },
    status: {
      branch: "main", ahead: 0, behind: 0, isClean: false,
      entries: [{ path: "src/a.ts", indexStatus: ".", worktreeStatus: "M", kind: "modified" }]
    },
    commits: [{
      id: "aaa111", parents: [], authorName: "Aster", authorEmail: "a@e.c",
      authorTimestamp: 1, committerName: "Aster", committerEmail: "a@e.c",
      committerTimestamp: 1, subject: "latest"
    }],
    generation: 5,
    updatedAt: 1
  };
}

test("AI context is pinned to the snapshot generation and goes stale when it moves", () => {
  const pkg = buildAiContextPackage(snapshotFixture());
  assert.equal(pkg.context.repositoryGeneration, 5);
  assert.deepEqual(pkg.context.commits, ["aaa111"]);
  assert.deepEqual(pkg.context.files, ["src/a.ts"]);
  assert.deepEqual(pkg.context.diffs, [{ path: "src/a.ts", kind: "modified" }]);
  assert.ok(pkg.markdown.includes("Generation: 5"));
  assert.ok(pkg.markdown.includes("src/a.ts (modified)"));

  const store = new AiContextStore();
  assert.equal(store.isStale(9), false); // nothing built yet
  store.set(pkg);
  assert.equal(store.isStale(5), false);
  assert.equal(store.isStale(6), true);

  store.addToSelection("aaa111");
  const selected = buildAiContextPackage(snapshotFixture(), { commits: store.selectedCommits() });
  assert.deepEqual(selected.context.commits, ["aaa111"]);
});

test("environment detection: shallow clone and sparse checkout are facts, not guesses", async t => {
  const available = await run("git", ["--version"]).then(() => true, () => false);
  if (!available) { t.skip("git not available"); return; }
  const executor = new NodeGitProcessExecutor();
  const src = await mkdtemp(join(tmpdir(), "gitnexus-env-src-"));
  const dst = await mkdtemp(join(tmpdir(), "gitnexus-env-dst-"));
  try {
    await run("git", ["init", "-b", "main"], { cwd: src });
    await run("git", ["config", "user.email", "t@e.c"], { cwd: src });
    await run("git", ["config", "user.name", "T"], { cwd: src });
    await writeFile(join(src, "a.txt"), "1\n");
    await run("git", ["add", "."], { cwd: src });
    await run("git", ["commit", "-m", "c1"], { cwd: src });
    await run("git", ["mkdir", "dir1"], { cwd: src }).catch(() => undefined);
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(src, "dir1"), { recursive: true });
    await writeFile(join(src, "dir1", "b.txt"), "2\n");
    await run("git", ["add", "."], { cwd: src });
    await run("git", ["commit", "-m", "c2"], { cwd: src });

    const normal = await detectRepositoryEnvironment(executor, src);
    assert.deepEqual(normal.features, {
      shallow: false, partialClone: false, sparseCheckout: false, sparseIndex: false
    });
    assert.equal(normal.lfs, false);

    await run("git", ["clone", "--depth", "1", `file://${src}`, join(dst, "shallow")]);
    const shallowEnv = await detectRepositoryEnvironment(executor, join(dst, "shallow"));
    assert.equal(shallowEnv.features.shallow, true);

    await run("git", ["clone", `file://${src}`, join(dst, "sparse")]);
    const sparseDir = join(dst, "sparse");
    await run("git", ["sparse-checkout", "init", "--cone"], { cwd: sparseDir });
    await run("git", ["sparse-checkout", "set", "dir1"], { cwd: sparseDir });
    const sparseEnv = await detectRepositoryEnvironment(executor, sparseDir);
    assert.equal(sparseEnv.features.sparseCheckout, true);
  } finally {
    await rm(src, { recursive: true, force: true });
    await rm(dst, { recursive: true, force: true });
  }
});
