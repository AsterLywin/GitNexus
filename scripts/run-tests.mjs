// Cross-platform test entry point.
//
// `node --test dist/test/*.test.js` only works when something expands
// the glob: newer Node versions do it themselves, POSIX shells do it,
// but Windows shells do not (npm runs scripts through cmd/PowerShell)
// and Node 20's test runner does not either — the Windows CI matrix
// failed with "Could not find '...\dist\test\*.test.js'". Enumerating
// the compiled test files and passing an explicit list works on every
// supported Node and shell.
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const testDir = path.join(root, "dist", "test");
const files = readdirSync(testDir)
  .filter(name => name.endsWith(".test.js"))
  .sort()
  .map(name => path.join(testDir, name));

if (files.length === 0) {
  console.error(`No compiled test files found in ${testDir} — did the build run?`);
  process.exit(1);
}

const result = spawnSync(process.execPath, ["--test", ...files], { stdio: "inherit" });
process.exit(result.status ?? 1);
