"use client";

import { useState } from "react";
import { useDashboardStore } from "@/hooks/use-dashboard-store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { triggerTaskRun, triggerDeadLetterRetry, triggerRescan } from "@/lib/api-client";
import { formatDateTime, formatUptime } from "@/lib/format";
import { Server, RefreshCw, Play, RotateCcw } from "lucide-react";

function statusBadgeVariant(status: string) {
  switch (status) {
    case "running":
      return "default" as const;
    case "dead-lettered":
      return "destructive" as const;
    case "retrying":
      return "secondary" as const;
    default:
      return "outline" as const;
  }
}

export function SchedulerPanel() {
  const taskDefinitions = useDashboardStore((s) => s.taskDefinitions);
  const tasks = useDashboardStore((s) => s.tasks);
  const deadLetters = useDashboardStore((s) => s.deadLetters);
  const health = useDashboardStore((s) => s.health);
  const overview = useDashboardStore((s) => s.overview);
  const activeProjectId = useDashboardStore((s) => s.activeProjectId);
  const [loadingTasks, setLoadingTasks] = useState<Set<string>>(new Set());

  const daemonRunning = overview?.daemon?.running ?? false;
  const pid = activeProjectId ?? undefined;

  async function handleRunTask(taskId: string) {
    setLoadingTasks((prev) => new Set(prev).add(taskId));
    try {
      await triggerTaskRun(taskId, pid);
    } finally {
      setLoadingTasks((prev) => {
        const next = new Set(prev);
        next.delete(taskId);
        return next;
      });
    }
  }

  async function handleRetryDeadLetter(taskId: string) {
    setLoadingTasks((prev) => new Set(prev).add(`dl-${taskId}`));
    try {
      await triggerDeadLetterRetry(taskId, pid);
    } finally {
      setLoadingTasks((prev) => {
        const next = new Set(prev);
        next.delete(`dl-${taskId}`);
        return next;
      });
    }
  }

  async function handleRescan() {
    setLoadingTasks((prev) => new Set(prev).add("rescan"));
    try {
      await triggerRescan(pid);
    } finally {
      setLoadingTasks((prev) => {
        const next = new Set(prev);
        next.delete("rescan");
        return next;
      });
    }
  }

  if (!overview) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-20" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Daemon Health */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium">
            <div className="flex items-center gap-2">
              <Server className="h-4 w-4" />
              Daemon Health
            </div>
          </CardTitle>
          <Badge variant={daemonRunning ? "default" : "destructive"}>
            {daemonRunning ? "running" : "offline"}
          </Badge>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {daemonRunning && health
              ? `Uptime: ${formatUptime(health.uptimeMs)}`
              : "Daemon not running"}
          </p>
        </CardContent>
      </Card>

      {/* Task Table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-medium">Scheduled Tasks</CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRescan}
            disabled={loadingTasks.has("rescan")}
          >
            <RefreshCw className={`h-3 w-3 mr-1 ${loadingTasks.has("rescan") ? "animate-spin" : ""}`} />
            Rescan Index
          </Button>
        </CardHeader>
        <CardContent>
          {taskDefinitions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tasks configured</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Task</TableHead>
                  <TableHead>Schedule</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last Run</TableHead>
                  <TableHead>Next Run</TableHead>
                  <TableHead>Failures</TableHead>
                  <TableHead className="w-20">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {taskDefinitions.map((def) => {
                  const record = tasks.find((r) => r.taskId === def.id);
                  const status = record?.status ?? "idle";
                  return (
                    <TableRow key={def.id}>
                      <TableCell>
                        <div>
                          <span className="font-medium text-sm">{def.name}</span>
                          {def.description && (
                            <p className="text-xs text-muted-foreground">{def.description}</p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs font-mono">{def.schedule}</TableCell>
                      <TableCell>
                        <Badge variant={statusBadgeVariant(status)}>{status}</Badge>
                      </TableCell>
                      <TableCell className="text-xs">
                        {formatDateTime(record?.lastRunAt ?? "")}
                      </TableCell>
                      <TableCell className="text-xs">
                        {formatDateTime(record?.nextRunAt ?? "")}
                      </TableCell>
                      <TableCell>{record?.consecutiveFailures ?? 0}</TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => handleRunTask(def.id)}
                          disabled={loadingTasks.has(def.id)}
                        >
                          <Play className="h-3 w-3" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Dead Letter Queue */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">
            Dead Letter Queue
            {deadLetters.length > 0 && (
              <Badge variant="destructive" className="ml-2">{deadLetters.length}</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {deadLetters.length === 0 ? (
            <p className="text-sm text-muted-foreground">No dead-lettered tasks</p>
          ) : (
            <div className="space-y-3">
              {deadLetters.map((dl) => (
                <div
                  key={dl.taskId}
                  className="flex items-start justify-between rounded-md border p-3"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{dl.taskId}</span>
                      <Badge variant="destructive" className="text-[10px]">
                        {dl.attemptCount} attempts
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Dead-lettered: {formatDateTime(dl.deadLetteredAt)}
                    </p>
                    {dl.errorMessages?.length > 0 && (
                      <p className="text-xs text-destructive">
                        {dl.errorMessages[dl.errorMessages.length - 1]}
                      </p>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleRetryDeadLetter(dl.taskId)}
                    disabled={loadingTasks.has(`dl-${dl.taskId}`)}
                  >
                    <RotateCcw className="h-3 w-3 mr-1" />
                    Retry
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
