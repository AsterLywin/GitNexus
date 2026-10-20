# GitNexus Engineering Status

## Implemented foundation

- Native Git process execution with timeout/cancellation
- Typed repository state
- Porcelain-v2 status parsing
- Commit history parsing
- DAG-based commit graph layout
- Interactive graph zoom/pan/selection
- Branch, remote and tag ref discovery
- Graph ref decorations
- Commit search qualifiers
- File history
- Blame CodeLens
- Commit details and diff
- Ref comparison
- Initial rebase service
- Initial worktree service

## Architectural rule

Feature code must depend on typed services, not directly on `child_process`.
Mutating Git operations must eventually pass through a repository mutation coordinator
that performs validation, locking, pre-state capture, execution, post-state refresh,
and cache invalidation.

## Next hardening areas

1. Mutation coordinator and repository locks
2. Operation-state detection and conflict UI
3. Full ref-aware graph topology
4. Interactive rebase editor
5. Worktree UI
6. SCM decorations and gutter actions
7. Virtualized graph rendering for large histories
8. Provider-neutral pull request layer
9. AI context engine and provider adapters


## Hardening slice

- Repository mutation coordinator
- Per-repository serialization lock
- Operation state model
- Rebase/merge/cherry-pick conflict detection
- Conflict path extraction
- Initial SCM resource provider
- Worktree manager
- Rebase planning validation

All mutating operations should migrate to `MutationCoordinator`; direct mutation
from feature code is considered a temporary compatibility path and should be removed.


## UI/SCM and Branch Workflow

Implemented in the current slice:

- Native VS Code Source Control provider
- Separate staged/unstaged resource groups
- File-level stage and unstage actions
- Branch discovery with upstream/ahead/behind data
- Branch switching and creation commands
- Rebase planner that enumerates `upstream..HEAD`
- Rebase plan execution through a temporary sequence-editor script
- Mutation Coordinator used for branch/stage/unstage/rebase mutations

Known next hardening targets:

1. full SCM diff/open/revert commands
2. branch delete/rename UI
3. conflict-resolution editor
4. true drag/drop rebase todo editor
5. graph-side branch actions
6. Git status file watching and automatic refresh


## Interactive Rebase + Conflict UX

- Webview interactive rebase planner
- Drag/drop commit ordering
- Rebase action selection: pick/reword/edit/squash/fixup/drop
- Rebase todo validation and serialization
- Conflict index inspection through `git ls-files -u`
- Conflict panel with open/use-ours/use-theirs/stage actions

The planner is intentionally separate from the Git engine so the same rebase
plan can later be driven by a CLI backend, libgit2 backend, or remote execution layer.

## SCM Completion Slice

- Native staged/unstaged SCM groups
- Commit input and staged commit command
- File diff command
- Safe discard confirmation
- Automatic repository refresh through FileSystemWatcher with debounce
- Branch delete/rename commands
- Stash push/list/apply/pop/drop workflow
- Conflict panel command wiring


## Commit Graph Performance Slice

- Render model separates graph topology from DOM/SVG rendering
- Row-based virtualization with overscan
- Graph filtering by text/ref/author/merge visibility
- Keyboard-style next/previous graph navigation model
- Dedicated virtual renderer
- Edge rendering preserves connections touching the visible window

The existing graph UI can adopt `GraphRenderModel` incrementally; this avoids
coupling Git history retrieval to a specific rendering technology.
