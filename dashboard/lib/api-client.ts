import type { OverviewPayload, TokenLedgerPayload, FileIndexPayload, SchedulerPayload, BugLogPayload, ActionLogPayload, ActionResult, DesignPayload, ConfigPanelPayload, SyncPanelPayload, ChannelPanelPayload, WikiPanelPayload, WikiNotePayload } from "@mink/types/dashboard";
import type { LearningMemory } from "@mink/types/learning-memory";
import type { ProjectsResponse } from "@/types/project";

async function fetchApi<T>(path: string, projectId?: string): Promise<T> {
  const url = projectId
    ? `${path}${path.includes("?") ? "&" : "?"}project=${encodeURIComponent(projectId)}`
    : path;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API error ${res.status}: ${path}`);
  return res.json();
}

export function fetchProjects() {
  return fetchApi<ProjectsResponse>("/api/projects");
}

export function fetchOverview(projectId?: string) {
  return fetchApi<OverviewPayload>("/api/overview", projectId);
}

export function fetchTokenLedger(projectId?: string) {
  return fetchApi<TokenLedgerPayload>("/api/token-ledger", projectId);
}

export function fetchFileIndex(projectId?: string) {
  return fetchApi<FileIndexPayload>("/api/file-index", projectId);
}

export function fetchScheduler(projectId?: string) {
  return fetchApi<SchedulerPayload>("/api/scheduler", projectId);
}

export function fetchLearningMemory(projectId?: string) {
  return fetchApi<LearningMemory>("/api/learning-memory", projectId);
}

export function fetchActionLog(projectId?: string) {
  return fetchApi<ActionLogPayload>("/api/action-log", projectId);
}

export function fetchBugs(projectId?: string) {
  return fetchApi<BugLogPayload>("/api/bugs", projectId);
}

export function fetchDesign(projectId?: string) {
  return fetchApi<DesignPayload>("/api/design", projectId);
}

export async function switchProject(projectId: string): Promise<ActionResult> {
  const res = await fetch("/api/switch-project", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId }),
  });
  return res.json();
}

export async function triggerTaskRun(taskId: string, projectId?: string): Promise<ActionResult> {
  const query = projectId ? `?project=${encodeURIComponent(projectId)}` : "";
  const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/run${query}`, { method: "POST" });
  return res.json();
}

export async function triggerDeadLetterRetry(taskId: string, projectId?: string): Promise<ActionResult> {
  const query = projectId ? `?project=${encodeURIComponent(projectId)}` : "";
  const res = await fetch(`/api/dead-letter/${encodeURIComponent(taskId)}/retry${query}`, { method: "POST" });
  return res.json();
}

export async function triggerRescan(projectId?: string): Promise<ActionResult> {
  const query = projectId ? `?project=${encodeURIComponent(projectId)}` : "";
  const res = await fetch(`/api/rescan${query}`, { method: "POST" });
  return res.json();
}

export async function triggerDaemonStart(): Promise<ActionResult> {
  const res = await fetch("/api/daemon/start", { method: "POST" });
  return res.json();
}

export async function triggerDaemonStop(): Promise<ActionResult> {
  const res = await fetch("/api/daemon/stop", { method: "POST" });
  return res.json();
}

export async function triggerDaemonRestart(): Promise<ActionResult> {
  const res = await fetch("/api/daemon/restart", { method: "POST" });
  return res.json();
}

export function fetchConfig() {
  return fetchApi<ConfigPanelPayload>("/api/config");
}

export async function setConfigValue(key: string, value: string): Promise<ActionResult> {
  const res = await fetch("/api/config/set", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, value }),
  });
  return res.json();
}

export async function resetConfigKey(key?: string, all?: boolean): Promise<ActionResult> {
  const res = await fetch("/api/config/reset", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, all }),
  });
  return res.json();
}

export function fetchSync() {
  return fetchApi<SyncPanelPayload>("/api/sync");
}

export async function triggerSyncPull(): Promise<ActionResult> {
  const res = await fetch("/api/sync/pull", { method: "POST" });
  return res.json();
}

export async function triggerSyncPush(): Promise<ActionResult> {
  const res = await fetch("/api/sync/push", { method: "POST" });
  return res.json();
}

export async function triggerSyncDisconnect(): Promise<ActionResult> {
  const res = await fetch("/api/sync/disconnect", { method: "POST" });
  return res.json();
}

export function fetchChannel() {
  return fetchApi<ChannelPanelPayload>("/api/channel");
}

export async function triggerChannelStart(): Promise<ActionResult> {
  const res = await fetch("/api/channel/start", { method: "POST" });
  return res.json();
}

export async function triggerChannelStop(): Promise<ActionResult> {
  const res = await fetch("/api/channel/stop", { method: "POST" });
  return res.json();
}

export async function triggerChannelRestart(): Promise<ActionResult> {
  const res = await fetch("/api/channel/restart", { method: "POST" });
  return res.json();
}

export function fetchWiki(options: { limit?: number; category?: string } = {}) {
  const params = new URLSearchParams();
  if (options.limit != null) params.set("limit", String(options.limit));
  if (options.category) params.set("category", options.category);
  const qs = params.toString();
  return fetchApi<WikiPanelPayload>(`/api/wiki${qs ? `?${qs}` : ""}`);
}

export function fetchWikiNote(path: string) {
  return fetchApi<WikiNotePayload>(`/api/wiki/note?path=${encodeURIComponent(path)}`);
}

export type CaptureNoteMode = "quick" | "structured";

export interface CaptureResult extends ActionResult {
  filePath?: string;
}

function dedupHeaders(dedupKey?: string): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (dedupKey) headers["X-Mink-Dedup-Key"] = dedupKey;
  return headers;
}

export async function createNote(args: {
  mode: CaptureNoteMode;
  title?: string;
  category?: string;
  body: string;
  tags?: string[];
  dedupKey?: string;
}): Promise<CaptureResult> {
  const res = await fetch("/api/wiki/notes", {
    method: "POST",
    headers: dedupHeaders(args.dedupKey),
    body: JSON.stringify({
      mode: args.mode,
      title: args.title,
      category: args.category,
      body: args.body,
      tags: args.tags,
    }),
  });
  return res.json();
}

export async function appendDaily(content: string, dedupKey?: string): Promise<CaptureResult> {
  const res = await fetch("/api/wiki/daily", {
    method: "POST",
    headers: dedupHeaders(dedupKey),
    body: JSON.stringify({ content }),
  });
  return res.json();
}

export async function ingestFile(args: {
  sourcePath: string;
  category: string;
  tags?: string[];
  dedupKey?: string;
}): Promise<CaptureResult> {
  const res = await fetch("/api/wiki/ingest", {
    method: "POST",
    headers: dedupHeaders(args.dedupKey),
    body: JSON.stringify({
      sourcePath: args.sourcePath,
      category: args.category,
      tags: args.tags,
    }),
  });
  return res.json();
}
