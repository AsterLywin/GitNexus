/**
 * Performance benchmark (GIT_ENGINE_SPEC §28 targets).
 *
 * Builds a 10,000-commit repository with git fast-import, then measures:
 *   - status on a clean tree (target < 150 ms on ordinary hardware)
 *   - status with 500 untracked files (target < 400 ms)
 *   - log parse for 10k commits
 *   - full graph layout for 10k commits (target < 2 s)
 *   - render model + a virtual render window (frame-budget relevant)
 *
 * Run: npm run benchmark   (builds first)
 * Prints a markdown table suitable for docs/PERFORMANCE.md.
 */
import { execFile, spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";

const run = promisify(execFile);
const COMMITS = 10000;

/** Feed a fast-import stream from a file (execFile's `input` can stall). */
function fastImport(cwd, scriptPath) {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["fast-import", "--quiet"], { cwd, stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve() : reject(new Error(`fast-import exited ${code}: ${stderr}`)));
    createReadStream(scriptPath).pipe(child.stdin);
  });
}

async function timed(label, fn, runs = 1) {
  const samples = [];
  let value;
  for (let i = 0; i < runs; i++) {
    const started = performance.now();
    value = await fn();
    samples.push(performance.now() - started);
  }
  const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
  return { label, ms: avg, value };
}

const { GitService } = await import("../dist/src/git/gitService.js");
const { NodeGitProcessExecutor } = await import("../dist/src/git/processExecutor.js");
const { CommitGraphLayout } = await import("../dist/src/features/graph/graphLayout.js");
const { createRenderModel, getRenderWindow } = await import("../dist/src/features/graph/graphModel.js");
const { GraphVirtualRenderer } = await import("../dist/src/features/graph/graphVirtualRenderer.js");

const dir = await mkdtemp(join(tmpdir(), "gitnexus-bench-"));
try {
  await run("git", ["init", "-b", "main"], { cwd: dir });
  const script = ["blob\nmark :1\ndata 4\none\n"];
  for (let i = 1; i <= COMMITS; i++) {
    const msg = `commit ${i}`;
    script.push(
      `commit refs/heads/main\nmark :${i + 1}\nauthor Bench <bench@example.com> 1700000000 +0000\ncommitter Bench <bench@example.com> 1700000000 +0000\ndata ${msg.length}\n${msg}\n${i === 1 ? "M 100644 :1 file.txt" : `from :${i}\nM 100644 :1 file.txt`}\n`
    );
  }
  const scriptPath = join(dir, "import.fi");
  await writeFile(scriptPath, script.join("\n"));
  await fastImport(dir, scriptPath);
  await rm(scriptPath);

  const git = new GitService(new NodeGitProcessExecutor());
  const results = [];

  results.push(await timed(`status (clean, ${COMMITS} commits)`, () => git.status(dir), 5));
  for (let i = 0; i < 500; i++) await writeFile(join(dir, `dirty-${i}.txt`), "x\n");
  results.push(await timed("status (500 untracked files)", () => git.status(dir), 5));

  const logResult = await timed(`log parse (${COMMITS} commits)`, () => git.log(dir, COMMITS), 3);
  results.push(logResult);

  const layoutResult = await timed(`graph layout (${COMMITS} commits)`, () => new CommitGraphLayout().build(logResult.value), 3);
  results.push(layoutResult);

  const modelResult = await timed("render model (10k rows)", () => createRenderModel(layoutResult.value), 3);
  results.push(modelResult);

  const windowResult = await timed("render window (rows 5000-5100)", () => getRenderWindow(modelResult.value, 5000, 5100), 10);
  results.push(windowResult);

  const renderer = new GraphVirtualRenderer();
  results.push(await timed("SVG render (100-row window)", () => renderer.render(windowResult.value), 10));

  console.error(`commits parsed: ${logResult.value.length}; layout nodes: ${layoutResult.value.nodes.length}`);
  console.log("| Measurement | Avg ms |");
  console.log("|---|---:|");
  for (const r of results) console.log(`| ${r.label} | ${r.ms.toFixed(1)} |`);
} finally {
  await rm(dir, { recursive: true, force: true });
}
