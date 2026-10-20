# Performance

Measured with `npm run benchmark` (scripts/benchmark.mjs): a synthetic
repository of **10,000 commits** created with `git fast-import`, timed
through the real engine (`GitService`, `CommitGraphLayout`,
`createRenderModel`, `getRenderWindow`, `GraphVirtualRenderer`).

Environment of the reference run: Linux VM, Node.js 24, Git 2.43.
Absolute numbers vary by machine; the targets are the contract.

| Measurement | Target (Engine Spec §28) | Measured |
|---|---:|---:|
| status (clean, 10k commits) | < 150 ms | **7.6 ms** |
| status (500 untracked files) | < 400 ms | **8.2 ms** |
| log parse (10,000 commits) | informational | 257.8 ms |
| graph layout (10,000 commits) | < 2,000 ms | **9.6 ms** |
| render model (10k rows) | informational | 18.4 ms |
| render window (100 rows, mid-history) | frame budget | 1.6 ms |
| SVG render (100-row window) | frame budget | 0.2 ms |

Notes:

- Status stays in single-digit milliseconds because porcelain v2 output
  is parsed in one pass and no per-file processes are spawned.
- Graph layout is linear over a single-parent chain; branching histories
  cost more (lane assignment), still far below the 2 s budget at 10k.
- The dominant cost at 10k commits is the `git log` invocation plus
  record parsing (~258 ms). Interactive loads cap the default page at
  200 commits; full-history loads are an explicit user action and can
  use the streaming API (`GitService.logStream`).
- Re-run locally with `npm run benchmark` before changing parser or
  layout code; regressions beyond 2× on any row should be investigated.
