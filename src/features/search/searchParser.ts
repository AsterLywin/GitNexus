import { CommitSearchQuery } from "./commitSearch";

export function parseCommitSearch(input: string): CommitSearchQuery {
  const query: CommitSearchQuery = { allRefs: true };
  const tokens = tokenize(input);

  const text: string[] = [];

  for (const token of tokens) {
    const colon = token.indexOf(":");
    if (colon > 0) {
      const key = token.slice(0, colon).toLowerCase();
      const value = token.slice(colon + 1);

      if (key === "author") query.author = value;
      else if (key === "file") query.file = value;
      else if (key === "after") query.after = value;
      else if (key === "before") query.before = value;
      else if (key === "message" || key === "commit") query.text = value;
      else text.push(token);
    } else {
      text.push(token);
    }
  }

  if (text.length) query.text = text.join(" ");
  return query;
}

function tokenize(input: string): string[] {
  const result: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(input))) {
    result.push(match[1] ?? match[2] ?? match[3]);
  }
  return result;
}
