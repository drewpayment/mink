import type { OverviewPayload, TokenLedgerPayload, FileIndexPayload, SchedulerPayload, BugLogPayload, ActionLogPayload, ActionResult, DesignPayload } from "@mink/types/dashboard";
import type { LearningMemory } from "@mink/types/learning-memory";

async function fetchApi<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`API error ${res.status}: ${path}`);
  return res.json();
}

export function fetchOverview() {
  return fetchApi<OverviewPayload>("/api/overview");
}

export function fetchTokenLedger() {
  return fetchApi<TokenLedgerPayload>("/api/token-ledger");
}

export function fetchFileIndex() {
  return fetchApi<FileIndexPayload>("/api/file-index");
}

export function fetchScheduler() {
  return fetchApi<SchedulerPayload>("/api/scheduler");
}

export function fetchLearningMemory() {
  return fetchApi<LearningMemory>("/api/learning-memory");
}

export function fetchActionLog() {
  return fetchApi<ActionLogPayload>("/api/action-log");
}

export function fetchBugs() {
  return fetchApi<BugLogPayload>("/api/bugs");
}

export function fetchDesign() {
  return fetchApi<DesignPayload>("/api/design");
}

export async function triggerTaskRun(taskId: string): Promise<ActionResult> {
  const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/run`, { method: "POST" });
  return res.json();
}

export async function triggerDeadLetterRetry(taskId: string): Promise<ActionResult> {
  const res = await fetch(`/api/dead-letter/${encodeURIComponent(taskId)}/retry`, { method: "POST" });
  return res.json();
}

export async function triggerRescan(): Promise<ActionResult> {
  const res = await fetch("/api/rescan", { method: "POST" });
  return res.json();
}
