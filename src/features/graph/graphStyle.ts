/**
 * Visual identity for the commit graph (GitLens-style): a stable color
 * per lane, a generated initial avatar per author (deterministic color
 * from the author's identity, so every commit shows a face even with
 * no Gravatar account), and compact relative timestamps.
 */

const LANE_COLORS = [
  "#4cc2ff", // blue
  "#3fb950", // green
  "#bc8cff", // purple
  "#ffa657", // orange
  "#ff7b72", // red
  "#f778ba", // pink
  "#7ee787", // light green
  "#79c0ff", // light blue
  "#d2a8ff", // light purple
  "#e3b341" // gold
];

export function laneColor(lane: number): string {
  const index = ((lane % LANE_COLORS.length) + LANE_COLORS.length) % LANE_COLORS.length;
  return LANE_COLORS[index];
}

const AVATAR_COLORS = [
  "#e5534b", "#db6d28", "#bf8700", "#1a7f37", "#0969da", "#8250df",
  "#bf3989", "#0550ae", "#116329", "#9e6a03", "#cf222e", "#6639ba",
  "#1b7c83", "#57606a"
];

function hashString(value: string): number {
  let hash = 5381;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) + hash + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

/** Stable avatar background color for an author identity. */
export function authorColor(identity: string): string {
  const key = identity.trim().toLowerCase();
  if (!key) return AVATAR_COLORS[AVATAR_COLORS.length - 1];
  return AVATAR_COLORS[hashString(key) % AVATAR_COLORS.length];
}

/** One or two initials for an author: "Aster Lywin" → "AL", "Aster" → "A". */
export function authorInitials(name: string, email = ""): string {
  const source = name.trim() || email.split("@")[0]?.replace(/[._-]+/g, " ").trim() || "";
  const words = source.split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/** Compact relative time: "just now", "5m ago", "5h ago", "3d ago", "2w ago", "4mo ago", "1y ago". */
export function formatRelativeTime(timestampSec: number, nowSec = Math.floor(Date.now() / 1000)): string {
  if (!timestampSec || timestampSec <= 0) return "";
  const diff = Math.max(0, nowSec - timestampSec);
  if (diff < 60) return "just now";
  const minutes = Math.floor(diff / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}
