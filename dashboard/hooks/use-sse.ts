"use client";

import { useEffect, useRef } from "react";
import { useDashboardStore, type ActionLogRow } from "./use-dashboard-store";
import {
  fetchOverview,
  fetchTokenLedger,
  fetchFileIndex,
  fetchScheduler,
  fetchLearningMemory,
  fetchActionLog,
  fetchBugs,
  fetchDesign,
} from "@/lib/api-client";
import type { ActionLogPayload, SchedulerPayload } from "@mink/types/dashboard";

function parseActionLogEntries(data: ActionLogPayload): ActionLogRow[] {
  const entries: ActionLogRow[] = [];
  const sessions = data?.sessions ?? [];
  for (const session of sessions) {
    const lines = (session.content || "").split("\n");
    for (const line of lines) {
      if (!line.startsWith("|") || line.includes("---")) continue;
      const cols = line
        .split("|")
        .map((c) => c.trim())
        .filter(Boolean);
      if (cols.length >= 5 && cols[0] !== "Time") {
        entries.push({
          time: cols[0],
          action: cols[1],
          files: cols[2],
          outcome: cols[3],
          tokens: cols[4],
        });
      }
    }
  }
  return entries;
}

function applySchedulerData(data: SchedulerPayload) {
  const combined = data.tasks || [];
  const tasks = combined.map((t) => t.state).filter(Boolean) as NonNullable<(typeof combined)[number]["state"]>[];
  const definitions = combined.map((t) => t.definition).filter(Boolean);
  const deadLetters = data.deadLetterQueue || [];
  useDashboardStore.getState().setScheduler(tasks, definitions, deadLetters);
}

function fetchAllData() {
  const store = useDashboardStore.getState();

  fetchOverview()
    .then((data) => {
      store.setOverview(data);
      if (data.daemon?.running) {
        store.setHealth({ uptimeMs: data.daemon.uptimeMs ?? 0 });
      } else {
        store.setHealth(null);
      }
    })
    .catch(console.warn);

  fetchTokenLedger().then(store.setLedger).catch(console.warn);
  fetchFileIndex().then(store.setFileIndex).catch(console.warn);
  fetchScheduler().then(applySchedulerData).catch(console.warn);
  fetchLearningMemory().then(store.setLearningMemory).catch(console.warn);
  fetchActionLog()
    .then((data) => store.setActionLog(parseActionLogEntries(data)))
    .catch(console.warn);
  fetchBugs()
    .then((data) => store.setBugs(data.entries || []))
    .catch(console.warn);
  fetchDesign()
    .then((data) => store.setDesignImages(data.images))
    .catch(console.warn);
}

function handleEvent(payload: { fileId?: string; type?: string }) {
  const store = useDashboardStore.getState();
  const fileId = payload.fileId || payload.type;

  switch (fileId) {
    case "token-ledger":
      fetchTokenLedger().then(store.setLedger).catch(console.warn);
      break;
    case "file-index":
      fetchFileIndex().then(store.setFileIndex).catch(console.warn);
      break;
    case "scheduler-manifest":
      fetchScheduler().then(applySchedulerData).catch(console.warn);
      break;
    case "learning-memory":
      fetchLearningMemory().then(store.setLearningMemory).catch(console.warn);
      break;
    case "action-log":
      fetchActionLog()
        .then((data) => store.setActionLog(parseActionLogEntries(data)))
        .catch(console.warn);
      break;
    case "bug-memory":
      fetchBugs()
        .then((data) => store.setBugs(data.entries || []))
        .catch(console.warn);
      break;
    case "session":
      fetchOverview()
        .then((data) => {
          store.setOverview(data);
          if (data.daemon?.running) {
            store.setHealth({ uptimeMs: data.daemon.uptimeMs ?? 0 });
          } else {
            store.setHealth(null);
          }
        })
        .catch(console.warn);
      break;
    case "design-report":
      fetchDesign()
        .then((data) => store.setDesignImages(data.images))
        .catch(console.warn);
      break;
    default:
      fetchAllData();
  }
}

export function useSSE() {
  const reconnectDelay = useRef(1000);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const MAX_DELAY = 30_000;

    function connect() {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }

      const es = new EventSource("/api/events");
      eventSourceRef.current = es;

      es.onopen = () => {
        reconnectDelay.current = 1000;
        useDashboardStore.getState().setConnected(true);
        fetchAllData();
      };

      es.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === "keepalive") return;
          handleEvent(payload);
        } catch (e) {
          console.warn("[mink] SSE parse error:", e);
        }
      };

      es.onerror = () => {
        useDashboardStore.getState().setConnected(false);
        es.close();
        eventSourceRef.current = null;
        scheduleReconnect();
      };
    }

    function scheduleReconnect() {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      reconnectTimer.current = setTimeout(() => {
        reconnectDelay.current = Math.min(reconnectDelay.current * 2, MAX_DELAY);
        connect();
      }, reconnectDelay.current);
    }

    connect();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
      }
    };
  }, []);
}
