/**
 * Time formatting for blame annotations. Two shapes: long ("3 months
 * ago") for the current-line annotation and hover, compact ("3mo") for
 * the fixed-width gutter column.
 */

const MINUTE = 60;
const HOUR = 3600;
const DAY = 86400;
const MONTH = 2592000; // 30 days
const YEAR = 31536000; // 365 days

export function formatRelativeTime(timestampSec: number, nowSec: number = Date.now() / 1000): string {
  const diff = Math.max(0, Math.floor(nowSec - timestampSec));
  if (diff < 45) return "just now";
  if (diff < HOUR) {
    const m = Math.max(1, Math.floor(diff / MINUTE));
    return m === 1 ? "1 minute ago" : `${m} minutes ago`;
  }
  if (diff < DAY) {
    const h = Math.floor(diff / HOUR);
    return h === 1 ? "1 hour ago" : `${h} hours ago`;
  }
  if (diff < MONTH) {
    const d = Math.floor(diff / DAY);
    return d === 1 ? "1 day ago" : `${d} days ago`;
  }
  if (diff < YEAR) {
    const mo = Math.floor(diff / MONTH);
    return mo === 1 ? "1 month ago" : `${mo} months ago`;
  }
  const y = Math.floor(diff / YEAR);
  return y === 1 ? "1 year ago" : `${y} years ago`;
}

export function formatRelativeShort(timestampSec: number, nowSec: number = Date.now() / 1000): string {
  const diff = Math.max(0, Math.floor(nowSec - timestampSec));
  if (diff < HOUR) return `${Math.max(1, Math.floor(diff / MINUTE))}m`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h`;
  if (diff < MONTH) return `${Math.floor(diff / DAY)}d`;
  if (diff < YEAR) return `${Math.floor(diff / MONTH)}mo`;
  return `${Math.floor(diff / YEAR)}y`;
}

/** Heat bucket 0 (newest line in file) .. 9 (oldest), linear between the two. */
export function heatBucket(timestampSec: number, newestSec: number, oldestSec: number): number {
  const span = Math.max(1, newestSec - oldestSec);
  const ratio = Math.min(1, Math.max(0, (newestSec - timestampSec) / span));
  return Math.min(9, Math.floor(ratio * 10));
}
