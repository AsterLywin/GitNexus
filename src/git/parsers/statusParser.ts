import { RepositoryStatus, WorkingTreeEntry, FileChangeKind } from "../../domain/git";

function kindFromStatus(x: string, y: string): FileChangeKind {
  if (x === "?" && y === "?") return "untracked";
  if (x === "!" && y === "!") return "ignored";
  if (x === "U" || y === "U" || (x === "A" && y === "A")) return "unmerged";
  if (x === "R" || y === "R") return "renamed";
  if (x === "C" || y === "C") return "copied";
  if (x === "A" || y === "A") return "added";
  if (x === "D" || y === "D") return "deleted";
  return "modified";
}

export function parsePorcelainV2Status(raw: string): RepositoryStatus {
  const records = raw.split("\0").filter(Boolean);
  let branch: string | undefined;
  let head: string | undefined;
  let ahead = 0;
  let behind = 0;
  const entries: WorkingTreeEntry[] = [];

  for (const record of records) {
    if (record.startsWith("# branch.head ")) {
      const value = record.slice("# branch.head ".length);
      branch = value === "(detached)" ? undefined : value;
      continue;
    }
    if (record.startsWith("# branch.oid ")) {
      const value = record.slice("# branch.oid ".length);
      head = value === "(initial)" ? undefined : value;
      continue;
    }
    if (record.startsWith("# branch.ab ")) {
      const match = record.match(/^# branch\.ab \+(\d+) -(\d+)$/);
      if (match) {
        ahead = Number(match[1]);
        behind = Number(match[2]);
      }
      continue;
    }

    const tag = record[0];
    if (tag !== "1" && tag !== "2" && tag !== "u" && tag !== "?") continue;

    if (tag === "?") {
      entries.push({
        path: record.slice(2),
        indexStatus: "?",
        worktreeStatus: "?",
        kind: "untracked"
      });
      continue;
    }

    if (tag === "u") {
      const fields = record.split(" ");
      const xy = fields[1] ?? "UU";
      entries.push({
        path: fields.slice(10).join(" "),
        indexStatus: xy[0] ?? "U",
        worktreeStatus: xy[1] ?? "U",
        kind: "unmerged"
      });
      continue;
    }

    const fields = record.split(" ");
    const xy = fields[1] ?? "..";
    const path = fields.slice(8).join(" ");
    entries.push({
      path,
      indexStatus: xy[0] ?? ".",
      worktreeStatus: xy[1] ?? ".",
      kind: kindFromStatus(xy[0] ?? ".", xy[1] ?? ".")
    });
  }

  return {
    branch,
    ahead,
    behind,
    head,
    entries,
    isClean: entries.length === 0
  };
}
