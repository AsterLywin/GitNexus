import { CommitSummary } from "../../domain/git";

const FIELD = "\x1f";
const RECORD = "\x1e";

export function parseLog(raw: string): CommitSummary[] {
  return raw
    .split(RECORD)
    .map(x => x.trim())
    .filter(Boolean)
    .map(record => {
      const f = record.split(FIELD);
      return {
        id: f[0] ?? "",
        parents: (f[1] ?? "").split(" ").filter(Boolean),
        authorName: f[2] ?? "",
        authorEmail: f[3] ?? "",
        authorTimestamp: Number(f[4] ?? 0),
        committerName: f[5] ?? "",
        committerEmail: f[6] ?? "",
        committerTimestamp: Number(f[7] ?? 0),
        subject: f[8] ?? "",
        body: f[9] || undefined
      };
    });
}
