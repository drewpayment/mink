import type { OverviewPayload, TokenLedgerPayload, FileIndexPayload, SchedulerPayload, BugLogPayload, ActionLogPayload, ActionResult, DesignPayload } from "@mink/types/dashboard";
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
