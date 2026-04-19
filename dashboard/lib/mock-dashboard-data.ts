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

export interface MockSyncPending {
  op: "A" | "M" | "D";
  file: string;
  delta: string;
}

export interface MockDiscordLog {
  t: string;
  m: string;
}

export interface MockConfigEntry {
  key: string;
  value: string | boolean | number;
  group: string;
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

export const MOCK_DISCORD = {
  status: "running" as const,
  bot: "mink-companion#1234",
  uptime: "3d 04h",
  messages: 42,
  token: "••••••••••••••••",
  allowlist: ["drew@1234", "sarah@5678"],
  logs: [
    { t: "11:58", m: "Received DM from drew: 'note jwt cookie pattern'" },
    { t: "11:58", m: "Captured note → patterns/jwt-cookie.md" },
    { t: "11:32", m: "Received DM from drew: 'search backoff'" },
    { t: "11:32", m: "Returned 3 matches from patterns/" },
    { t: "10:41", m: "Heartbeat OK" },
  ] as MockDiscordLog[],
};

export const MOCK_SYNC = {
  branch: "main",
  remote: "git@github.com:drewpayment/mink-wiki.git",
  ahead: 2,
  behind: 0,
  lastPush: "11:45",
  lastPull: "08:12",
  pending: [
    { op: "A", file: "inbox/2026-04-19-rate-limits.md", delta: "+24" },
    { op: "M", file: "daily/2026-04-19.md",             delta: "+3 -1" },
  ] as MockSyncPending[],
};

export const MOCK_CONFIG: MockConfigEntry[] = [
  { group: "Wiki",      key: "wiki.path",                value: "~/.mink/wiki" },
  { group: "Wiki",      key: "wiki.enabled",             value: true },
  { group: "Notes",     key: "notes.template",           value: "project" },
  { group: "Notes",     key: "notes.auto-tag",           value: true },
  { group: "Sync",      key: "sync.auto-pull",           value: true },
  { group: "Sync",      key: "sync.auto-push",           value: true },
  { group: "Sync",      key: "sync.timeout-ms",          value: 15000 },
  { group: "Channels",  key: "channel.discord.enabled",  value: true },
  { group: "Channels",  key: "channel.skip-permissions", value: false },
  { group: "Daemon",    key: "daemon.heartbeat-seconds", value: 5 },
  { group: "Daemon",    key: "daemon.auto-restart",      value: true },
  { group: "Daemon",    key: "daemon.boot-on-login",     value: false },
  { group: "Dashboard", key: "dashboard.port",           value: 4040 },
  { group: "Logging",   key: "log.level",                value: "info" },
  { group: "Runtime",   key: "runtime.prefer-bun",       value: true },
];
