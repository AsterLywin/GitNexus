import assert from "node:assert/strict";
import test from "node:test";
import { GitHubPullRequestProvider } from "../src/features/pr/githubProvider";
import {
  mapBitbucketReview,
  mapBitbucketStatuses,
  BitbucketPullRequestProvider
} from "../src/features/pr/bitbucketProvider";
import {
  mapGitLabApproval,
  mapGitLabPipelineStatus,
  GitLabPullRequestProvider
} from "../src/features/pr/gitlabProvider";
import { compareUrl, parseGitHubRemote } from "../src/features/pr/remoteInfo";

test("GitHub Enterprise remotes need a declared host; API base becomes /api/v3", async () => {
  assert.equal(parseGitHubRemote("https://ghe.corp.example/team/repo.git"), undefined);
  const remote = parseGitHubRemote("git@ghe.corp.example:team/repo.git", ["ghe.corp.example"]);
  assert.deepEqual(remote, { owner: "team", repo: "repo", host: "ghe.corp.example" });
  assert.equal(
    compareUrl(remote!, "main", "feat"),
    "https://ghe.corp.example/team/repo/compare/main...feat?expand=1"
  );

  let seenUrl = "";
  const provider = new GitHubPullRequestProvider({
    remote: remote!,
    getToken: async () => "t",
    fetchFn: (async (url: unknown) => {
      seenUrl = String(url);
      return { ok: true, status: 200, json: async () => [], text: async () => "" };
    }) as never
  });
  await provider.listOpen();
  assert.ok(seenUrl.startsWith("https://ghe.corp.example/api/v3/repos/team/repo/pulls"));
});

test("enrichment mappers: GitLab pipelines/approvals, Bitbucket statuses/review", () => {
  assert.equal(mapGitLabPipelineStatus("success"), "success");
  assert.equal(mapGitLabPipelineStatus("failed"), "failure");
  assert.equal(mapGitLabPipelineStatus("running"), "pending");
  assert.equal(mapGitLabPipelineStatus(undefined), "unknown");
  assert.equal(mapGitLabApproval({ approved: true }), "approved");
  assert.equal(mapGitLabApproval({ approvals_required: 2, approved_by: [] }), "pending");
  assert.equal(mapGitLabApproval({}), "none");

  assert.equal(mapBitbucketStatuses([]), "unknown");
  assert.equal(mapBitbucketStatuses([{ state: "SUCCESSFUL" }, { state: "FAILED" }]), "failure");
  assert.equal(mapBitbucketStatuses([{ state: "INPROGRESS" }]), "pending");
  assert.equal(mapBitbucketStatuses([{ state: "SUCCESSFUL" }]), "success");
  assert.equal(mapBitbucketReview({ participants: [{ approved: true }] }), "approved");
  assert.equal(mapBitbucketReview({ reviewers: [{}] }), "pending");
  assert.equal(mapBitbucketReview({}), "none");
});

test("GitLab forBranch enriches with pipeline CI + approval state", async () => {
  const urls: string[] = [];
  const provider = new GitLabPullRequestProvider({
    remote: { host: "gitlab.com", projectPath: "g/p" },
    getToken: async () => "tok",
    fetchFn: (async (url: unknown) => {
      const u = String(url);
      urls.push(u);
      const payload = u.includes("/pipelines")
        ? [{ status: "success" }]
        : u.includes("/approvals")
          ? { approved: true }
          : [{
              id: 1, iid: 3, title: "MR", state: "opened", web_url: "w", sha: "sha1",
              source_branch: "feat", target_branch: "main", author: { username: "ada" }
            }];
      return { ok: true, status: 200, json: async () => payload, text: async () => "" };
    }) as never
  });
  const mr = await provider.forBranch("feat");
  assert.equal(mr?.ciStatus, "success");
  assert.equal(mr?.reviewStatus, "approved");
  assert.ok(urls.some(u => u.includes("pipelines?sha=sha1")));
  assert.ok(urls.some(u => u.includes("merge_requests/3/approvals")));
});

test("Bitbucket forBranch enriches with commit statuses + participants", async () => {
  const provider = new BitbucketPullRequestProvider({
    remote: { workspace: "ws", repo: "repo" },
    getAuthHeader: async () => "Basic x",
    fetchFn: (async (url: unknown) => {
      const u = String(url);
      const payload = u.includes("/statuses")
        ? { values: [{ state: "FAILED" }] }
        : u.includes("/pullrequests/9")
          ? { participants: [{ approved: false }], reviewers: [{}, {}] }
          : {
              values: [{
                id: 9, title: "PR", state: "OPEN", author: { display_name: "Ada" },
                source: { branch: { name: "feat" }, commit: { hash: "h9" } },
                destination: { branch: { name: "main" } }, links: { html: { href: "u" } }
              }]
            };
      return { ok: true, status: 200, json: async () => payload, text: async () => "" };
    }) as never
  });
  const pr = await provider.forBranch("feat");
  assert.equal(pr?.ciStatus, "failure");
  assert.equal(pr?.reviewStatus, "pending");
});
