import assert from "node:assert/strict";
import test from "node:test";
import {
  askByok,
  chooseByokProvider,
  geminiUrl,
  openAiUrl,
  parseGeminiResponse,
  parseOpenAiResponse,
  ByokConfig
} from "../src/features/ai/byok";
import { assembleAutolinkRules, linkifyMarkdown } from "../src/features/commit/autolinks";
import {
  canCheckout,
  prCheckoutRefspec,
  slugifyIssueBranch,
  sortLaunchpadItems,
  LaunchpadItem
} from "../src/features/launchpad/launchpadModel";
import { mapBitbucketIssue, mapBitbucketPullRequest } from "../src/features/pr/bitbucketProvider";
import { mapGitHubIssue } from "../src/features/pr/githubProvider";
import { mapGitLabIssue, mapGitLabMergeRequest } from "../src/features/pr/gitlabProvider";
import { commitWebUrl, issueWebUrlTemplate } from "../src/features/pr/remoteInfo";

const config: ByokConfig = {
  provider: "auto",
  geminiModel: "gemini-2.5-flash",
  openAiBaseUrl: "https://api.openai.com/v1",
  openAiModel: "gpt-4o-mini"
};

test("BYOK provider choice, URLs and response parsing", async () => {
  assert.equal(chooseByokProvider(config, true, true), "gemini");
  assert.equal(chooseByokProvider(config, false, true), "openai");
  assert.equal(chooseByokProvider(config, false, false), undefined);
  assert.equal(chooseByokProvider({ ...config, provider: "lm" }, true, true), undefined);
  assert.equal(chooseByokProvider({ ...config, provider: "openai" }, true, false), undefined);
  assert.ok(geminiUrl("gemini-2.5-flash").endsWith("/models/gemini-2.5-flash:generateContent"));
  assert.equal(openAiUrl("https://x.example/v1/"), "https://x.example/v1/chat/completions");
  assert.equal(parseGeminiResponse({ candidates: [{ content: { parts: [{ text: "a" }, { text: "b" }] } }] }), "ab");
  assert.equal(parseOpenAiResponse({ choices: [{ message: { content: " hi " } }] }), "hi");

  const noKey = await askByok("p", config, async () => undefined, fetch);
  assert.equal(noKey, undefined);

  let seenAuth = "";
  const gemini = await askByok("p", config, async () => "KEY",
    (async (_url: unknown, init?: { headers?: Record<string, string> }) => {
      seenAuth = init?.headers?.["x-goog-api-key"] ?? "";
      return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: "msg" }] } }] }), text: async () => "" };
    }) as never);
  assert.equal(gemini, "msg");
  assert.equal(seenAuth, "KEY");
});

test("issue mappers + fork flags across providers", () => {
  const gh = mapGitHubIssue({
    id: 1, number: 12, title: "Bug", state: "open", html_url: "u",
    user: { login: "ada" }, labels: [{ name: "bug" }, "ui"]
  });
  assert.deepEqual(gh.labels, ["bug", "ui"]);
  assert.equal(gh.number, 12);

  const gl = mapGitLabIssue({
    id: 2, iid: 5, title: "Feat", state: "opened", web_url: "u2",
    labels: ["enhancement"], author: { username: "bob" }
  });
  assert.equal(gl.state, "open");
  assert.equal(gl.number, 5);

  const bb = mapBitbucketIssue({
    id: 7, title: "Crash", state: "new", reporter: { display_name: "Cy" },
    links: { html: { href: "u3" } }
  });
  assert.equal(bb.state, "open");

  const forkMr = mapGitLabMergeRequest({
    id: 3, iid: 9, title: "F", state: "opened", web_url: "u", sha: "s",
    source_branch: "x", target_branch: "main",
    source_project_id: 111, target_project_id: 222, author: { username: "ada" }
  });
  assert.equal(forkMr.fork, true);

  const bbPr = mapBitbucketPullRequest({
    id: 4, title: "P", state: "OPEN",
    source: { branch: { name: "f" }, repository: { full_name: "other/repo" } },
    destination: { branch: { name: "main" } }, links: { html: { href: "u" } }
  }, "ws/repo");
  assert.equal(bbPr.fork, true);
});

test("launchpad helpers: refspecs, checkout eligibility, branch slugs, sorting", () => {
  assert.equal(prCheckoutRefspec("github", { number: 7, headBranch: "x" }), "pull/7/head:pr-7");
  assert.equal(prCheckoutRefspec("gitlab", { number: 7, headBranch: "x" }), "merge-requests/7/head:pr-7");
  assert.equal(prCheckoutRefspec("bitbucket", { number: 7, headBranch: "feat" }), "feat:pr-7");

  const base: LaunchpadItem = {
    kind: "pr", providerId: "bitbucket", providerName: "Bitbucket", repoSlug: "w/r",
    root: "/r", number: 1, title: "t", author: "a", url: "u"
  };
  assert.equal(canCheckout(base), true);
  assert.equal(canCheckout({ ...base, fork: true }), false);
  assert.equal(canCheckout({ ...base, providerId: "github", fork: true }), true);
  assert.equal(canCheckout({ ...base, kind: "issue" }), false);

  assert.equal(slugifyIssueBranch(42, "Fix: Login page crashes!!"), "42-fix-login-page-crashes");
  assert.equal(slugifyIssueBranch(3, "!!!"), "3-issue");

  const sorted = sortLaunchpadItems([
    { ...base, kind: "issue", number: 9 },
    { ...base, kind: "pr", number: 2 },
    { ...base, kind: "pr", number: 5 }
  ]);
  assert.deepEqual(sorted.map(i => `${i.kind}:${i.number}`), ["pr:5", "pr:2", "issue:9"]);
});

test("remote web URLs + autolinks for GitLab and Bitbucket remotes", () => {
  assert.equal(commitWebUrl("git@gitlab.com:g/p.git", "abc"), "https://gitlab.com/g/p/-/commit/abc");
  assert.equal(commitWebUrl("https://bitbucket.org/ws/repo.git", "abc"), "https://bitbucket.org/ws/repo/commits/abc");
  assert.equal(commitWebUrl("https://example.com/a/b", "abc"), undefined);
  assert.equal(issueWebUrlTemplate("git@gitlab.example.com:team/repo.git"),
    "https://gitlab.example.com/team/repo/-/issues/<num>");

  const rules = assembleAutolinkRules([], ["git@gitlab.com:team/repo.git"]);
  const linked = linkifyMarkdown("see #12", rules);
  assert.ok(linked.includes("https://gitlab.com/team/repo/-/issues/12"));
});
