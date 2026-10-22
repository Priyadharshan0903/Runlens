// Display helpers shared by the UI components.

export function formatDuration(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return "";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${Math.round(s % 60)}s`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export function between(start?: string, end?: string): number | undefined {
  if (!start || !end) return undefined;
  const ms = Date.parse(end) - Date.parse(start);
  return Number.isFinite(ms) ? ms : undefined;
}

export function formatAgo(iso: string | undefined, now = Date.now()): string {
  if (!iso) return "";
  const ms = now - Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const min = Math.round(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export function formatClock(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/** Sidebar section for a session, by the day it was last active. */
export function dayGroup(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const day = 86_400_000;
  const t = d.getTime();
  if (t >= startOfToday) return "Today";
  if (t >= startOfToday - day) return "Yesterday";
  if (t >= startOfToday - 6 * day) return "Earlier this week";
  if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth())
    return "Earlier this month";
  return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

export function formatCost(usd: number | undefined): string {
  if (usd === undefined) return "";
  if (usd === 0) return "$0.00";
  return usd < 0.01 ? "<$0.01" : `$${usd.toFixed(2)}`;
}

/** "/Users/me/Desktop/Projects/foo" → "foo" */
export function projectName(cwd: string | undefined): string {
  if (!cwd) return "unknown";
  return cwd.split("/").filter(Boolean).pop() ?? cwd;
}

export function firstLine(text: string | undefined, max = 140): string {
  // Skip blank lines and code fences so "```json\n{...}" doesn't summarise as "```json".
  const line =
    (text ?? "")
      .trim()
      .split("\n")
      .find((l) => l.trim() && !l.trim().startsWith("```")) ?? "";
  const clean = line.replace(/^#+\s*/, "").replace(/\*\*/g, "");
  return clean.length > max ? clean.slice(0, max - 1) + "…" : clean;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}
