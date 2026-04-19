/**
 * Mock data for "preview" panels — Wiki, Capture, Discord, Sync, Config.
 *
 * These panels don't have backend endpoints yet. When the corresponding
 * daemon APIs land, replace the imports here with real data from the
 * dashboard store.
 *
 * The shape is intentionally narrow — just what the UI needs. Don't grow
 * this into a domain model; real domain types live in `@mink/types/*`.
 */

export interface MockNote {
  title: string;
  path: string;
  tags: string[];
  cat: "inbox" | "daily" | "project" | "resource" | "pattern" | "area";
  at: string;
}

export const MOCK_NOTES = {
  totalNotes: 214,
  inbox: 3,
  recent: [
    { title: "Rate-limit investigation",   path: "inbox/2026-04-19-rate-limits.md",   tags: ["api","backend"],  cat: "inbox",    at: "11:34" },
    { title: "JWT Cookie Pattern",         path: "patterns/jwt-cookie.md",           tags: ["auth","security"], cat: "pattern",  at: "Apr 18" },
    { title: "Exponential Backoff",        path: "patterns/backoff.md",              tags: ["reliability"],     cat: "pattern",  at: "Apr 18" },
    { title: "2026-04-19 Daily",           path: "daily/2026-04-19.md",              tags: [],                  cat: "daily",    at: "08:12" },
    { title: "Mink dashboard redesign",    path: "projects/mink/dashboard.md",       tags: ["ui","design"],     cat: "project",  at: "Apr 19" },
    { title: "Turbopack HMR notes",        path: "resources/turbopack.md",           tags: ["nextjs","build"],  cat: "resource", at: "Apr 17" },
  ] as MockNote[],
  tags: [
    ["api", 12], ["backend", 18], ["auth", 7], ["security", 9],
    ["reliability", 5], ["ui", 22], ["design", 14], ["nextjs", 19],
    ["build", 8], ["pattern", 24], ["meeting", 6],
  ] as [string, number][],
};


