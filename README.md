# GitNexus

GitNexus is an open-source, local-first Git intelligence extension for VS Code.

## Current foundation

The first engineering slice establishes:

- typed Git process execution
- repository discovery
- porcelain-v2 status parsing
- commit history parsing
- repository state snapshots
- repository lifecycle management
- command registration
- initial VS Code commands

## Development

```bash
npm install
npm run build
```

Press `F5` in VS Code to launch an Extension Development Host.

## Commands

- `GitNexus: Open Commit Graph`
- `GitNexus: Refresh Repository`
- `GitNexus: Show Status`

## Architecture

```text
VS Code Commands
      ↓
Application Services
      ↓
Repository Manager
      ↓
Repository State Store
      ↓
Git Services
      ↓
Git Process Executor
      ↓
Git CLI
```

GitNexus is designed so the Git backend can later be replaced or extended without coupling feature code to process execution.


## Current UI/UX slice

GitNexus now includes a stronger VS Code-native workflow layer:

- Source Control groups for staged and unstaged changes
- Stage / unstage file commands
- Branch switch and branch creation
- Branch tracking information (ahead/behind)
- Rebase planner with commit selection
- Rebase plan execution through a generated `GIT_SEQUENCE_EDITOR`
- Repository mutation serialization for these operations
