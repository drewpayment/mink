import { existsSync, readFileSync } from "fs";
import {
  projectDir,
  projectDbPath,
  actionLogPath,
  learningMemoryPath,
  projectMetaPath,
  sessionPath,
  configPath,
  schedulerManifestPath,
  designReportPath,
} from "./paths";
import { safeReadJson } from "./fs-utils";
import { FileIndexRepo } from "../repositories/file-index-repo";
import { CountersRepo } from "../repositories/counters-repo";
import { loadLedger } from "./token-ledger";
import { parseLearningMemory } from "./learning-memory";
import { loadBugMemory } from "./bug-memory";
import { safeReadLog, parseLogSessions } from "./action-log";
import {
  aggregateTokenLedger,
  aggregateBugMemory,
  aggregateActionLog,
  aggregateLearningMemory,
} from "./state-aggregator";
import { getDaemonStatus, startDaemon, stopDaemon } from "./daemon";
import { loadManifest, removeFromDeadLetter, saveManifest } from "./scheduler";
import { getBuiltInTasks, executeTask } from "./task-registry";
import {
  resolveAllConfig,
  setConfigValue,
  resetConfigKey,
  resetAllConfig,
} from "./global-config";
import {
  getSyncStatus,
  syncPull,
  syncPush,
  disconnectSync,
  isSyncInitialized,
} from "./sync";
import {
  getChannelStatus,
  getChannelLogs,
  startChannelProcess,
  stopChannelProcess,
  isChannelRunning,
} from "./channel-process";
import { resolveConfigValue } from "./global-config";
import { resolveVaultPath, isVaultInitialized } from "./vault";
import type { ChannelPlatform } from "../types/channel";
import { loadVaultIndex, getRecentNotes, updateVaultIndexForFile } from "./note-index";
import { extractWikilinks } from "./note-linker";
import { createNote, appendToDaily, ingestFile } from "./note-writer";
import { readdirSync, readFileSync as readFileSyncFS, existsSync as fsExistsSync } from "fs";
import { join, resolve, normalize, sep } from "path";
import type { VaultIndexEntry, NoteCategory } from "../types/note";
import { minkRoot } from "./paths";
import { execSync } from "child_process";
import { isValidConfigKey, CONFIG_KEYS } from "../types/config";
import type { ConfigKey } from "../types/config";
import type {
  OverviewPayload,
  TokenLedgerPayload,
  FileIndexPayload,
  SchedulerPayload,
  BugLogPayload,
  ActionLogPayload,
  ActionResult,
  FileStatus,
  DesignPayload,
  ConfigPanelPayload,
  ConfigEntry,
  ConfigValueSource,
  ConfigValueType,
  SyncPanelPayload,
  SyncPendingChange,
  ChannelPanelPayload,
  ChannelLogLine,
  WikiPanelPayload,
  WikiNotePayload,
  WikiTreeNode,
  CompressionPayload,
} from "../types/dashboard";
import { TokenLedgerRepo } from "../repositories/token-ledger-repo";
import { loadCompressionConfig } from "./compression";
import { isDesignEvalReport } from "../types/design-eval";
import type { DesignEvalReport } from "../types/design-eval";
import type { FileIndex, FileIndexEntry } from "../types/file-index";
import type { LearningMemory } from "../types/learning-memory";

// ── Secret Masking ─────────────────────────────────────────────────────────

const SECRET_KEY_PATTERNS = [/token/i, /secret/i, /password/i, /api[-_]?key/i];

export function isSecretKey(key: string): boolean {
  return SECRET_KEY_PATTERNS.some((re) => re.test(key));
}

export function maskSecret(value: string, showLast: number = 4): string {
  if (!value) return "";
  if (value.length <= showLast) return "••••";
  return "••••" + value.slice(-showLast);
}

// ── File Status Checks ─────────────────────────────────────────────────────

function checkJsonFile(
  name: string,
  filePath: string,
  validator?: (v: unknown) => boolean
): FileStatus {
  if (!existsSync(filePath)) return { name, status: "missing" };
  const data = safeReadJson(filePath);
  if (data === null) return { name, status: "corrupt" };
  if (validator && !validator(data)) return { name, status: "corrupt" };
  return { name, status: "ok" };
}

function checkTextFile(name: string, filePath: string): FileStatus {
  if (!existsSync(filePath)) return { name, status: "missing" };
  try {
    readFileSync(filePath, "utf-8");
    return { name, status: "ok" };
  } catch {
    return { name, status: "corrupt" };
  }
}

function checkDbFile(name: string, filePath: string): FileStatus {
  if (!existsSync(filePath)) return { name, status: "missing" };
  try {
    const header = readFileSync(filePath).slice(0, 16).toString("utf-8");
    return header.startsWith("SQLite format 3")
      ? { name, status: "ok" }
      : { name, status: "corrupt" };
  } catch {
    return { name, status: "corrupt" };
  }
}

// ── Panel Loaders ──────────────────────────────────────────────────────────

export function loadOverview(cwd: string): OverviewPayload {
  // Project metadata
  let project: OverviewPayload["project"] = null;
  const meta = safeReadJson(projectMetaPath(cwd)) as {
    name?: string;
    description?: string;
  } | null;
  if (meta && typeof meta === "object") {
    project = {
      name: meta.name ?? "Unknown",
      description: meta.description ?? "",
      cwd,
    };
  }

  // Daemon status
  const daemonStatus = getDaemonStatus(cwd);
  const daemon: OverviewPayload["daemon"] = {
    running: daemonStatus.running,
    pid: daemonStatus.pid,
    startedAt: daemonStatus.startedAt,
    uptimeMs: daemonStatus.startedAt
      ? Date.now() - new Date(daemonStatus.startedAt).getTime()
      : undefined,
  };

  // Token ledger summary (aggregated across all device shards + legacy)
  const ledger = aggregateTokenLedger(cwd);
  const summary = {
    totalSessions: ledger.lifetime.totalSessions,
    totalTokens: ledger.lifetime.totalTokens,
    totalReads: ledger.lifetime.totalReads,
    totalWrites: ledger.lifetime.totalWrites,
    estimatedSavings: ledger.lifetime.totalEstimatedSavings,
  };

  // State file health. mink.db replaced file-index.json in Phase 2; the
  // other JSON checks remain until Phases 3 (bug-memory) and 4 (ledger).
  const stateFiles: FileStatus[] = [
    checkJsonFile("session.json", sessionPath(cwd)),
    checkDbFile("mink.db", projectDbPath(cwd)),
    checkJsonFile("config.json", configPath(cwd)),
    checkTextFile("learning-memory.md", learningMemoryPath(cwd)),
    checkTextFile("action-log.md", actionLogPath(cwd)),
    checkJsonFile("scheduler-manifest.json", schedulerManifestPath(cwd)),
  ];

  return { project, daemon, summary, compression: ledger.compression, stateFiles };
}

export function loadTokenLedgerPanel(cwd: string): TokenLedgerPayload {
  const ledger = aggregateTokenLedger(cwd);
  return {
    lifetime: ledger.lifetime,
    sessions: ledger.sessions,
    wasteFlags: ledger.wasteFlags ?? [],
    compression: ledger.compression,
  };
}

// Dedicated Compression panel (spec 21, phase 4). Reads the measured
// compression aggregates, the holdout A/B split, per-kind/per-tool breakdowns,
// and recent events, plus whether compression is currently enabled.
export function loadCompressionPanel(cwd: string): CompressionPayload {
  const repo = TokenLedgerRepo.for(cwd);
  return {
    enabled: loadCompressionConfig().enabled,
    lifetime: repo.compressionLifetime(),
    arms: repo.compressionArms(),
    byKind: repo.compressionBreakdown("content_kind"),
    byTool: repo.compressionBreakdown("tool_name"),
    recent: repo.compressionEvents(50),
  };
}

export function loadFileIndexPanel(cwd: string): FileIndexPayload {
  // file_index + per-device counters now live in mink.db; we synthesize
  // the FileIndexPayload shape the dashboard expects so the frontend
  // doesn't need to change in this phase.
  try {
    const repo = FileIndexRepo.for(cwd);
    const entries: FileIndexEntry[] = repo.listAll();
    const totals = CountersRepo.for(cwd).totals();
    return {
      header: {
        lastScanTimestamp: repo.getLastScanTimestamp(),
        totalFiles: repo.totalFiles(),
        lifetimeHits: totals.hits,
        lifetimeMisses: totals.misses,
      },
      entries,
    };
  } catch {
    return {
      header: {
        lastScanTimestamp: "",
        totalFiles: 0,
        lifetimeHits: 0,
        lifetimeMisses: 0,
      },
      entries: [],
    };
  }
}

export function loadSchedulerPanel(cwd: string): SchedulerPayload {
  const manifest = loadManifest(cwd);
  const definitions = getBuiltInTasks();

  const tasks = definitions.map((def) => {
    const state = manifest?.tasks.find((t) => t.taskId === def.id) ?? null;
    return { definition: def, state };
  });

  return {
    tasks,
    deadLetterQueue: manifest?.deadLetterQueue ?? [],
    lastHeartbeat: manifest?.lastHeartbeat ?? null,
  };
}

export function loadLearningMemoryPanel(cwd: string): LearningMemory {
  return aggregateLearningMemory(cwd);
}

export function loadActionLogPanel(cwd: string): ActionLogPayload {
  const content = aggregateActionLog(cwd);
  const sessions = parseLogSessions(content);
  return { sessions };
}

export function loadBugLogPanel(cwd: string): BugLogPayload {
  const memory = aggregateBugMemory(cwd);
  return { entries: memory.entries, nextId: memory.nextId };
}

export function loadDesignPanel(cwd: string): DesignPayload {
  const raw = safeReadJson(designReportPath(cwd));
  if (!raw || !isDesignEvalReport(raw)) {
    return { images: [] };
  }

  const report = raw as DesignEvalReport;
  return {
    images: report.captures.map((c) => ({
      url: `/api/design-images/${c.fileName}`,
      route: c.route,
      viewport: c.viewport,
      section: c.section,
      timestamp: c.timestamp,
    })),
  };
}

// ── Config Panel ───────────────────────────────────────────────────────────

const BOOLEAN_VALUES = new Set(["true", "false"]);
const GROUP_LABELS: Record<string, string> = {
  wiki: "Wiki",
  notes: "Notes",
  sync: "Sync",
  channel: "Channels",
};

function groupFromKey(key: string): string {
  const prefix = key.split(".")[0] ?? "other";
  return GROUP_LABELS[prefix] ?? prefix.charAt(0).toUpperCase() + prefix.slice(1);
}

function inferType(defaultValue: string, currentValue: string): ConfigValueType {
  const candidate = currentValue || defaultValue;
  if (BOOLEAN_VALUES.has(candidate)) return "boolean";
  if (candidate !== "" && !Number.isNaN(Number(candidate)) && /^-?\d+(\.\d+)?$/.test(candidate)) {
    return "number";
  }
  return "string";
}

function mapSource(
  source: "default" | "config file" | "environment variable",
  scope: "shared" | "local",
): ConfigValueSource {
  if (source === "environment variable") return "env";
  if (source === "default") return "default";
  return scope;
}

export function loadConfigPanel(): ConfigPanelPayload {
  const resolved = resolveAllConfig();

  const entries: ConfigEntry[] = resolved.map((r) => {
    const meta = CONFIG_KEYS.find((k) => k.key === r.key)!;
    const isSecret = isSecretKey(r.key);
    return {
      key: r.key,
      value: isSecret ? maskSecret(r.value) : r.value,
      source: mapSource(r.source, r.scope),
      type: inferType(meta.default, r.value),
      group: groupFromKey(r.key),
      scope: r.scope,
      description: meta.description,
      isSecret,
    };
  });

  return { entries };
}

// ── Sync Panel ─────────────────────────────────────────────────────────────

function parsePorcelain(output: string): SyncPendingChange[] {
  const changes: SyncPendingChange[] = [];
  for (const rawLine of output.split("\n")) {
    if (!rawLine.trim()) continue;
    // Porcelain v1 format: `XY file` where X = staged, Y = unstaged, and
    // untracked files are prefixed with "??".
    const xy = rawLine.slice(0, 2);
    const file = rawLine.slice(3);
    let op: SyncPendingChange["op"];
    if (xy === "??") op = "?";
    else if (xy.includes("D")) op = "D";
    else if (xy.includes("A") || xy.includes("?")) op = "A";
    else op = "M";
    changes.push({ op, file });
  }
  return changes;
}

function getAheadBehind(branch: string): { ahead: number; behind: number } {
  if (!branch) return { ahead: 0, behind: 0 };
  try {
    const raw = execSync(
      `git rev-list --left-right --count origin/${branch}...${branch}`,
      { cwd: minkRoot(), timeout: 5000, stdio: ["pipe", "pipe", "pipe"] },
    )
      .toString()
      .trim();
    const [behindStr, aheadStr] = raw.split(/\s+/);
    return {
      behind: Number(behindStr) || 0,
      ahead: Number(aheadStr) || 0,
    };
  } catch {
    return { ahead: 0, behind: 0 };
  }
}

function getPendingChanges(): SyncPendingChange[] {
  try {
    const raw = execSync("git status --porcelain", {
      cwd: minkRoot(),
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    })
      .toString();
    return parsePorcelain(raw);
  } catch {
    return [];
  }
}

export function loadSyncPanel(): SyncPanelPayload {
  const status = getSyncStatus();
  const initialized = isSyncInitialized();
  const pending = status.gitInitialized ? getPendingChanges() : [];
  const { ahead, behind } = status.gitInitialized
    ? getAheadBehind(status.branch)
    : { ahead: 0, behind: 0 };

  return {
    initialized,
    enabled: status.enabled,
    branch: status.branch,
    remote: status.remoteUrl,
    ahead,
    behind,
    lastPush: status.lastPush,
    lastPull: status.lastPull,
    pending,
  };
}

// ── Channel Panel ──────────────────────────────────────────────────────────

const CHANNEL_LOG_LIMIT = 120;
const TIMESTAMP_PREFIX = /^\[?(\d{1,2}:\d{2}(?::\d{2})?)\]?\s*/;

function parseChannelLogs(raw: string | null): ChannelLogLine[] {
  if (!raw) return [];
  const lines = raw.split("\n").map((l) => l.replace(/\u001b\[[0-9;]*m/g, "").trim()).filter(Boolean);
  const parsed: ChannelLogLine[] = lines.map((line) => {
    const match = line.match(TIMESTAMP_PREFIX);
    if (match) {
      return { t: match[1], m: line.slice(match[0].length) };
    }
    return { t: "", m: line };
  });
  return parsed.slice(-CHANNEL_LOG_LIMIT);
}

function parseAllowlist(raw: string): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function loadChannelPanel(): ChannelPanelPayload {
  const running = isChannelRunning();
  const status = running ? getChannelStatus() : null;
  const rawLogs = running ? getChannelLogs() : null;
  const logs = parseChannelLogs(rawLogs);

  const token = resolveConfigValue("channel.discord.bot-token").value;
  const allowlistRaw = resolveConfigValue("channel.discord.allowlist").value;
  const autoStart = resolveConfigValue("channel.discord.enabled").value === "true";

  return {
    status: running ? "running" : "stopped",
    platform: status?.platform ?? null,
    session: status?.session ?? "",
    startedAt: status?.startedAt ?? "",
    uptimeSec: status?.uptime ?? 0,
    autoStart,
    tokenMasked: maskSecret(token),
    allowlist: parseAllowlist(allowlistRaw),
    logs,
  };
}

// ── Wiki Panel ─────────────────────────────────────────────────────────────

const WIKI_TREE_MAX_DEPTH = 2;
const WIKI_TREE_EXCLUDES = new Set([
  ".obsidian",
  ".git",
  ".mink-vault.json",
  ".mink-index.json",
  "node_modules",
]);
const DEFAULT_RECENT_LIMIT = 25;

function countMarkdownIn(dir: string): number {
  let count = 0;
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (WIKI_TREE_EXCLUDES.has(entry.name) || entry.name.startsWith(".")) continue;
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        count += countMarkdownIn(fullPath);
      } else if (entry.name.endsWith(".md") && !entry.name.startsWith("_")) {
        count += 1;
      }
    }
  } catch {
    // Unreadable dir — return zero.
  }
  return count;
}

function buildVaultTree(root: string): WikiTreeNode[] {
  const nodes: WikiTreeNode[] = [];
  function walk(dir: string, depth: number) {
    if (depth > WIKI_TREE_MAX_DEPTH) return;
    let entries: { name: string; isDir: boolean }[] = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true })
        .filter((e) => !WIKI_TREE_EXCLUDES.has(e.name) && !e.name.startsWith("."))
        .map((e) => ({ name: e.name, isDir: e.isDirectory() }));
    } catch {
      return;
    }
    entries.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const entry of entries) {
      if (!entry.isDir) continue;
      const fullPath = join(dir, entry.name);
      const relPath = fullPath.slice(root.length + 1);
      const count = countMarkdownIn(fullPath);
      nodes.push({ name: entry.name, path: relPath, count, depth });
      walk(fullPath, depth + 1);
    }
  }
  walk(root, 0);
  return nodes;
}

function tallyTags(entries: VaultIndexEntry[]): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    for (const tag of entry.tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
}

interface WikiPanelOptions {
  limit?: number;
  category?: NoteCategory | "all";
}

export function loadWikiPanel(opts: WikiPanelOptions = {}): WikiPanelPayload {
  const initialized = isVaultInitialized();
  const vaultPath = resolveVaultPath();

  if (!initialized) {
    return {
      initialized: false,
      vaultPath,
      totalNotes: 0,
      inboxCount: 0,
      recent: [],
      tags: [],
      tree: [],
    };
  }

  const index = loadVaultIndex();
  const allEntries = Object.values(index.entries);
  const limit = Math.max(1, Math.min(opts.limit ?? DEFAULT_RECENT_LIMIT, 200));
  let recent = getRecentNotes(limit);
  if (opts.category && opts.category !== "all") {
    recent = recent.filter((e) => e.category === opts.category);
  }
  const inboxCount = allEntries.filter((e) => e.category === "inbox").length;
  const tags = tallyTags(allEntries);
  const tree = buildVaultTree(vaultPath);

  return {
    initialized: true,
    vaultPath,
    totalNotes: index.totalNotes || allEntries.length,
    inboxCount,
    recent,
    tags,
    tree,
  };
}

function parseFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string } {
  if (!content.startsWith("---")) return { frontmatter: {}, body: content };
  const end = content.indexOf("\n---", 3);
  if (end === -1) return { frontmatter: {}, body: content };
  const raw = content.slice(3, end).trim();
  const body = content.slice(end + 4).replace(/^\n/, "");
  const frontmatter: Record<string, unknown> = {};
  // Minimal YAML parser — supports key: value and key: [a, b] — good enough for note FM.
  for (const rawLine of raw.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const valRaw = line.slice(colonIdx + 1).trim();
    if (valRaw.startsWith("[") && valRaw.endsWith("]")) {
      frontmatter[key] = valRaw
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
    } else {
      frontmatter[key] = valRaw.replace(/^["']|["']$/g, "");
    }
  }
  return { frontmatter, body };
}

function resolveVaultRelativePath(relPath: string): string | null {
  if (!relPath || relPath.includes("\0")) return null;
  const root = resolveVaultPath();
  const absolute = resolve(root, relPath);
  const normalizedRoot = normalize(root) + sep;
  if (!absolute.startsWith(normalizedRoot) && absolute !== normalize(root)) {
    return null;
  }
  return absolute;
}

export function loadWikiNote(relPath: string): WikiNotePayload | null {
  const absolute = resolveVaultRelativePath(relPath);
  if (!absolute) return null;
  let content: string;
  try {
    content = readFileSyncFS(absolute, "utf-8");
  } catch {
    return null;
  }
  const { frontmatter, body } = parseFrontmatter(content);

  // Backlinks: look for wikilinks referencing this note's title or filename.
  const index = loadVaultIndex();
  const thisEntry = index.entries[relPath];
  const targetTitle = thisEntry?.title ?? relPath.replace(/\.md$/, "");
  const targetBasename = relPath.replace(/\.md$/, "").split("/").pop() ?? "";

  const backlinks: Array<{ path: string; title: string }> = [];
  for (const entry of Object.values(index.entries)) {
    if (entry.filePath === relPath) continue;
    const absSource = resolveVaultRelativePath(entry.filePath);
    if (!absSource) continue;
    let sourceContent: string;
    try {
      sourceContent = readFileSyncFS(absSource, "utf-8");
    } catch {
      continue;
    }
    const links = extractWikilinks(sourceContent);
    const matches = links.some(
      (l) => l === targetTitle || l === targetBasename || l === relPath,
    );
    if (matches) {
      backlinks.push({ path: entry.filePath, title: entry.title });
    }
  }

  return { path: relPath, frontmatter, body, backlinks };
}

// ── Action Triggers ────────────────────────────────────────────────────────

export async function triggerTask(
  cwd: string,
  taskId: string
): Promise<ActionResult> {
  try {
    await executeTask(taskId, cwd);
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function triggerDeadLetterRetry(
  cwd: string,
  taskId: string
): Promise<ActionResult> {
  try {
    const manifest = loadManifest(cwd);
    if (!manifest) {
      return { success: false, error: "No scheduler manifest found" };
    }

    const entry = removeFromDeadLetter(manifest, taskId);
    if (!entry) {
      return { success: false, error: `Task ${taskId} not in dead letter queue` };
    }

    // Reset the task record
    const record = manifest.tasks.find((t) => t.taskId === taskId);
    if (record) {
      record.status = "idle";
      record.consecutiveFailures = 0;
      record.currentAttempt = 0;
    }

    saveManifest(cwd, manifest);
    await executeTask(taskId, cwd);
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function triggerRescan(cwd: string): Promise<ActionResult> {
  try {
    const { scan } = await import("../commands/scan");
    scan(cwd, { check: false });
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function triggerDaemonStart(cwd: string): Promise<ActionResult> {
  try {
    startDaemon(cwd);
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function triggerDaemonStop(): Promise<ActionResult> {
  try {
    await stopDaemon();
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function triggerDaemonRestart(cwd: string): Promise<ActionResult> {
  try {
    await stopDaemon();
    startDaemon(cwd);
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function triggerConfigSet(
  key: string,
  value: string,
): Promise<ActionResult> {
  try {
    if (!isValidConfigKey(key)) {
      return { success: false, error: `Unknown config key: ${key}` };
    }
    if (typeof value !== "string") {
      return { success: false, error: "Config value must be a string" };
    }
    setConfigValue(key as ConfigKey, value);
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function triggerSyncPull(): Promise<ActionResult> {
  try {
    if (!isSyncInitialized()) {
      return { success: false, error: "Sync is not initialized" };
    }
    const errors: string[] = [];
    syncPull((msg) => errors.push(msg));
    if (errors.length > 0) {
      return { success: false, error: errors.join("\n") };
    }
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function triggerSyncPush(): Promise<ActionResult> {
  try {
    if (!isSyncInitialized()) {
      return { success: false, error: "Sync is not initialized" };
    }
    const errors: string[] = [];
    syncPush((msg) => errors.push(msg));
    if (errors.length > 0) {
      return { success: false, error: errors.join("\n") };
    }
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function triggerChannelStart(): Promise<ActionResult> {
  try {
    if (!isVaultInitialized()) {
      return {
        success: false,
        error: "Vault is not initialized. Run `mink wiki init` first.",
      };
    }
    const platform = (resolveConfigValue("channel.default-platform").value as ChannelPlatform) || "discord";
    const token = resolveConfigValue("channel.discord.bot-token").value;
    if (!token) {
      return {
        success: false,
        error: "No bot token configured. Set channel.discord.bot-token first.",
      };
    }
    const skipPermissions = resolveConfigValue("channel.skip-permissions").value === "true";
    const vaultPath = resolveVaultPath();
    await startChannelProcess({ vaultPath, platform, token, skipPermissions });
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function triggerChannelStop(): Promise<ActionResult> {
  try {
    await stopChannelProcess();
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function triggerChannelRestart(): Promise<ActionResult> {
  const stop = await triggerChannelStop();
  if (!stop.success) return stop;
  return triggerChannelStart();
}

export async function triggerSyncDisconnect(): Promise<ActionResult> {
  try {
    disconnectSync();
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

const VALID_CATEGORIES: NoteCategory[] = ["inbox", "projects", "areas", "resources", "archives"];

function isValidCategory(cat: unknown): cat is NoteCategory {
  return typeof cat === "string" && (VALID_CATEGORIES as string[]).includes(cat);
}

function firstNonEmptyLine(s: string): string {
  for (const line of s.split("\n")) {
    const trimmed = line.trim().replace(/^#+\s*/, "");
    if (trimmed) return trimmed;
  }
  return "";
}

function deriveQuickTitle(body: string): string {
  const first = firstNonEmptyLine(body);
  if (!first) return `quick-capture-${new Date().toISOString().slice(0, 10)}`;
  return first.slice(0, 80);
}

// In-memory idempotency tracker: maps dedup key -> created filePath.
// Keys are TTL'd to cap memory (10 min window is generous for UI double-submits).
const DEDUP_TTL_MS = 10 * 60 * 1000;
const dedupCache = new Map<string, { filePath: string; expiresAt: number }>();

function checkDedup(key: string | undefined): { filePath: string } | null {
  if (!key) return null;
  const now = Date.now();
  // Sweep expired entries lazily.
  for (const [k, v] of dedupCache) {
    if (v.expiresAt < now) dedupCache.delete(k);
  }
  const hit = dedupCache.get(key);
  return hit && hit.expiresAt >= now ? { filePath: hit.filePath } : null;
}

function recordDedup(key: string | undefined, filePath: string): void {
  if (!key) return;
  dedupCache.set(key, { filePath, expiresAt: Date.now() + DEDUP_TTL_MS });
}

export interface CaptureNoteRequest {
  mode: "quick" | "structured";
  title?: string;
  category?: string;
  body: string;
  tags?: string[];
  dedupKey?: string;
}

export async function triggerCreateNote(
  req: CaptureNoteRequest,
): Promise<ActionResult & { filePath?: string }> {
  try {
    if (!isVaultInitialized()) {
      return { success: false, error: "Vault is not initialized. Run `mink wiki init` first." };
    }
    if (typeof req.body !== "string" || !req.body.trim()) {
      return { success: false, error: "Body is required" };
    }

    const existing = checkDedup(req.dedupKey);
    if (existing) return { success: true, filePath: existing.filePath };

    const category: NoteCategory = isValidCategory(req.category)
      ? req.category
      : "inbox";
    const title = (req.title?.trim() || "") || deriveQuickTitle(req.body);
    const tags = (req.tags ?? []).map((t) => t.trim()).filter(Boolean);
    const now = new Date().toISOString();

    const result = createNote({
      title,
      category,
      tags,
      created: now,
      updated: now,
      body: req.body,
    });

    updateVaultIndexForFile(result.filePath, result.content);
    recordDedup(req.dedupKey, result.filePath);
    return { success: true, filePath: result.filePath };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function triggerAppendDaily(
  content: string,
  dedupKey?: string,
): Promise<ActionResult & { filePath?: string }> {
  try {
    if (!isVaultInitialized()) {
      return { success: false, error: "Vault is not initialized." };
    }
    if (typeof content !== "string" || !content.trim()) {
      return { success: false, error: "Content is required" };
    }

    const existing = checkDedup(dedupKey);
    if (existing) return { success: true, filePath: existing.filePath };

    const today = new Date().toISOString().slice(0, 10);
    const filePath = appendToDaily(today, content);
    const updated = readFileSyncFS(filePath, "utf-8");
    updateVaultIndexForFile(filePath, updated);
    recordDedup(dedupKey, filePath);
    return { success: true, filePath };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function triggerIngestFile(
  sourcePath: string,
  category: string,
  tags?: string[],
  dedupKey?: string,
): Promise<ActionResult & { filePath?: string }> {
  try {
    if (!isVaultInitialized()) {
      return { success: false, error: "Vault is not initialized." };
    }
    if (!sourcePath) {
      return { success: false, error: "sourcePath is required" };
    }
    if (!isValidCategory(category)) {
      return { success: false, error: `Invalid category: ${category}` };
    }
    const expanded = sourcePath.startsWith("~/")
      ? join(process.env.HOME ?? "", sourcePath.slice(2))
      : sourcePath;
    if (!fsExistsSync(expanded)) {
      return { success: false, error: `Source file not found: ${sourcePath}` };
    }

    const existing = checkDedup(dedupKey);
    if (existing) return { success: true, filePath: existing.filePath };

    const result = ingestFile(expanded, { category, tags });
    updateVaultIndexForFile(result.filePath, result.content);
    recordDedup(dedupKey, result.filePath);
    return { success: true, filePath: result.filePath };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function triggerConfigReset(
  key?: string,
  all?: boolean,
): Promise<ActionResult> {
  try {
    if (all) {
      resetAllConfig();
      return { success: true };
    }
    if (!key) {
      return { success: false, error: "Missing key (or set all: true)" };
    }
    if (!isValidConfigKey(key)) {
      return { success: false, error: `Unknown config key: ${key}` };
    }
    resetConfigKey(key as ConfigKey);
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
