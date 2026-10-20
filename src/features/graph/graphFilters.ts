import { GraphRenderNode } from "./graphModel";

export interface GraphFilter {
  text?: string;
  refs?: string[];
  authors?: string[];
  hideMerges?: boolean;
}

export function filterGraphNodes(nodes: GraphRenderNode[], filter: GraphFilter): GraphRenderNode[] {
  const text = filter.text?.trim().toLowerCase();
  const refs = new Set(filter.refs ?? []);
  const authors = new Set((filter.authors ?? []).map(a => a.toLowerCase()));

  return nodes.filter(node => {
    if (filter.hideMerges && node.parents.length > 1) return false;

    if (text) {
      const haystack = [
        node.id,
        node.label ?? "",
        node.author ?? ""
      ].join(" ").toLowerCase();

      if (!haystack.includes(text)) return false;
    }

    if (refs.size && !node.refs?.some(ref => refs.has(ref))) return false;
    if (authors.size && !authors.has((node.author ?? "").toLowerCase())) return false;

    return true;
  });
}
