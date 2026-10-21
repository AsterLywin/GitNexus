import assert from "node:assert/strict";
import test from "node:test";
import { BitbucketPullRequestProvider, mapBitbucketPullRequest } from "../src/features/pr/bitbucketProvider";
import { GitLabPullRequestProvider, mapGitLabMergeRequest } from "../src/features/pr/gitlabProvider";
import { parseBitbucketRemote, parseGitLabRemote } from "../src/features/pr/remoteInfo";

test("parseGitLabRemote: gitlab.com, nested groups, self-hosted, extra hosts", () => {
  assert.deepEqual(parseGitLabRemote("https://gitlab.com/group/sub/project.git"),
    { host: "gitlab.com", projectPath: "group/sub/project" });
  assert.deepEqual(parseGitLabRemote("git@gitlab.example.com:team/repo.git"),
    { host: "gitlab.example.com", projectPath: "team/repo" });
  assert.equal(parseGitLabRemote("https://git.example.com/team/repo.git"), undefined);
  assert.deepEqual(parseGitLabRemote("https://git.example.com/team/repo.git", ["git.example.com"]),
    { host: "git.example.com", projectPath: "team/repo" });
  assert.equal(parseGitLabRemote("https://github.com/a/b.git"), undefined);
  assert.equal(parseGitLabRemote("https://gitlab.com/onlyname.git"), undefined);
});

test("parseBitbucketRemote: cloud spellings only", () => {
  assert.deepEqual(parseBitbucketRemote("https://bitbucket.org/ws/repo.git"), { workspace: "ws", repo: "repo" });
  assert.deepEqual(parseBitbucketRemote("git@bitbucket.org:ws/repo.git"), { workspace: "ws", repo: "repo" });
  assert.equal(parseBitbucketRemote("https://bitbucket.org/a/b/c"), undefined);
  assert.equal(parseBitbucketRemote("https://github.com/a/b"), undefined);
});

test("mappers normalize states and fields", () => {
  const mr = mapGitLabMergeRequest({
    id: 91, iid: 7, title: "Add thing", state: "merged", web_url: "https://gitlab.com/g/p/-/merge_requests/7",
    sha: "abc123", source_branch: "feat", target_branch: "main", author: { username: "ada" }
  });
  assert.equal(mr.number, 7);
  assert.equal(mr.state, "merged");
  assert.equal(mr.author, "ada");
  assert.equal(mr.headSha, "abc123");

  const pr = mapBitbucketPullRequest({
    id: 5, title: "Fix", state: "DECLINED",
    author: { display_name: "Ada L" },
    source: { branch: { name: "fix" }, commit: { hash: "deadbeef" } },
    destination: { branch: { name: "main" } },
    links: { html: { href: "https://bitbucket.org/ws/repo/pull-requests/5" } }
  });
  assert.equal(pr.state, "closed");
  assert.equal(pr.number, 5);
  assert.equal(pr.headBranch, "fix");
});

function fakeFetch(capture: { url?: string; headers?: unknown }, payload: unknown): typeof fetch {
  return (async (url: unknown, init?: { headers?: unknown }) => {
    capture.url = String(url);
    capture.headers = init?.headers;
    return { ok: true, status: 200, json: async () => payload, text: async () => "" };
  }) as never;
}

test("GitLab provider: encoded project path, PRIVATE-TOKEN header, createUrl", async () => {
  const capture: { url?: string; headers?: unknown } = {};
  const provider = new GitLabPullRequestProvider({
    remote: { host: "gitlab.com", projectPath: "group/sub/project" },
    getToken: async () => "tok123",
    fetchFn: fakeFetch(capture, [{
      id: 1, iid: 2, title: "T", state: "opened", web_url: "u", sha: "s",
      source_branch: "f", target_branch: "main", author: { username: "ada" }
    }])
  });
  const open = await provider.listOpen();
  assert.equal(open.length, 1);
  assert.ok(capture.url?.includes("/projects/group%2Fsub%2Fproject/merge_requests"));
  assert.deepEqual(capture.headers, { "PRIVATE-TOKEN": "tok123" });
  assert.ok(provider.createUrl("main", "feat x").includes("merge_request%5Bsource_branch%5D=feat+x"));

  const noToken = new GitLabPullRequestProvider({
    remote: { host: "gitlab.com", projectPath: "g/p" },
    getToken: async () => undefined,
    fetchFn: fakeFetch({}, [])
  });
  await assert.rejects(() => noToken.listOpen(), /Set GitLab Token/);
});

test("Bitbucket provider: values unwrap, auth header, forBranch filter", async () => {
  const capture: { url?: string; headers?: unknown } = {};
  const provider = new BitbucketPullRequestProvider({
    remote: { workspace: "ws", repo: "repo" },
    getAuthHeader: async () => "Basic dXNlcjpwYXNz",
    fetchFn: fakeFetch(capture, {
      values: [
        { id: 1, title: "A", state: "OPEN", author: { display_name: "Ada" },
          source: { branch: { name: "feat" }, commit: { hash: "h1" } },
          destination: { branch: { name: "main" } }, links: { html: { href: "u1" } } },
        { id: 2, title: "B", state: "OPEN", author: { display_name: "Bob" },
          source: { branch: { name: "other" }, commit: { hash: "h2" } },
          destination: { branch: { name: "main" } }, links: { html: { href: "u2" } } }
      ]
    })
  });
  const open = await provider.listOpen();
  assert.equal(open.length, 2);
  assert.deepEqual((capture.headers as { authorization: string }).authorization, "Basic dXNlcjpwYXNz");
  const forFeat = await provider.forBranch("feat");
  assert.equal(forFeat?.title, "A");
  assert.equal(await provider.forBranch("missing"), undefined);
  assert.ok(provider.createUrl("main", "feat").startsWith("https://bitbucket.org/ws/repo/pull-requests/new?"));
});
