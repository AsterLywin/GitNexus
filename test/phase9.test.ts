import assert from "node:assert/strict";
import test from "node:test";
import { buildCommitMessagePrompt, buildExplainCommitPrompt, truncateDiff } from "../src/features/ai/prompts";
import {
  assembleAutolinkRules,
  githubRemotePath,
  linkifyMarkdown
} from "../src/features/commit/autolinks";
import { gravatarUrl } from "../src/features/graph/avatar";
import { GraphVirtualRenderer } from "../src/features/graph/graphVirtualRenderer";
import { RenderWindow } from "../src/features/graph/graphModel";

test("gravatar URL uses the trimmed/lowercased md5 of the email", () => {
  // Gravatar's documented example hash for myemailaddress@example.com.
  assert.equal(
    gravatarUrl("  MyEmailAddress@example.com ", 32),
    "https://www.gravatar.com/avatar/0bc83cb571cd1c50ba6f3e8a78ef1346?s=32&d=identicon"
  );
  assert.equal(gravatarUrl(""), undefined);
  assert.equal(gravatarUrl("not-an-email"), undefined);
});

test("graph renderer draws avatar/author/date/hash columns only when enabled", () => {
  const node = {
    id: "abcdef1234567890",
    lane: 0,
    laneX: 18,
    row: 0,
    label: "feat: thing",
    author: "Ada Lovelace",
    authorEmail: "ada@example.com",
    authorTimestamp: 1760000000,
    commit: undefined,
    parents: []
  } as never;
  const window: RenderWindow = { startRow: 0, endRow: 1, nodes: [node], edges: [], maxLane: 0 };
  const renderer = new GraphVirtualRenderer();

  const bare = renderer.render(window, undefined, {});
  assert.ok(!bare.includes("gravatar.com"));
  assert.ok(!bare.includes("Ada Lovelace"));

  const full = renderer.render(window, undefined, { avatar: true, author: true, date: true, hash: true });
  // Phase 15: avatars are generated initials (deterministic author
  // color), not external Gravatar images.
  assert.ok(full.includes(">AL<"), "initial avatar renders");
  assert.ok(!full.includes("gravatar.com"), "no external avatar image");
  assert.ok(full.includes("Ada Lovelace"));
  assert.ok(full.includes(new Date(1760000000 * 1000).toISOString().slice(0, 10)));
  assert.ok(full.includes("abcdef1"));
});

test("githubRemotePath accepts https, scp-like and ssh spellings", () => {
  assert.equal(githubRemotePath("https://github.com/AsterLywin/GitNexus.git"), "AsterLywin/GitNexus");
  assert.equal(githubRemotePath("git@github.com:AsterLywin/GitNexus.git"), "AsterLywin/GitNexus");
  assert.equal(githubRemotePath("ssh://git@github.com/AsterLywin/GitNexus"), "AsterLywin/GitNexus");
  assert.equal(githubRemotePath("https://gitlab.com/a/b.git"), undefined);
});

test("linkifyMarkdown links #issues and custom prefixes, escapes the rest", () => {
  const rules = assembleAutolinkRules(
    [{ prefix: "PROJ-", url: "https://jira.example.com/browse/PROJ-<num>" }],
    ["git@github.com:AsterLywin/GitNexus.git"]
  );
  const linked = linkifyMarkdown("fix #123 and PROJ-45 *now*", rules);
  assert.ok(linked.includes("[\\#123](https://github.com/AsterLywin/GitNexus/issues/123)"));
  assert.ok(linked.includes("[PROJ\\-45](https://jira.example.com/browse/PROJ-45)"));
  assert.ok(linked.includes("\\*now\\*"));

  // Glued to a word character: not a reference.
  assert.equal(linkifyMarkdown("file#99", rules), "file\\#99");
  // No rules: pure escaping.
  assert.equal(linkifyMarkdown("a *b* #1", []), "a \\*b\\* \\#1");
});

test("AI prompts embed the diff, truncate it, and set their contract", () => {
  const prompt = buildCommitMessagePrompt("diff --git a/x b/x\n+line");
  assert.ok(prompt.includes("ONLY the commit message"));
  assert.ok(prompt.includes("+line"));

  const big = "x".repeat(20000);
  assert.ok(truncateDiff(big).includes("[diff truncated]"));
  assert.ok(truncateDiff(big).length < 8300);

  const explain = buildExplainCommitPrompt("feat: x", "body text", "diffdata");
  assert.ok(explain.includes("feat: x"));
  assert.ok(explain.includes("body text"));
  assert.ok(explain.includes("diffdata"));
});
