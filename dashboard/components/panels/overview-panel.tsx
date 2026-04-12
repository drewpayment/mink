"use client";

import { useDashboardStore } from "@/hooks/use-dashboard-store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatNum, formatUptime } from "@/lib/format";
import { Activity, Coins, BookOpen, PenLine, FolderOpen, TrendingUp, Server } from "lucide-react";

const statCards = [
  { id: "sessions", label: "Total Sessions", icon: Activity, getValue: (o: NonNullable<ReturnType<typeof useDashboardStore.getState>["overview"]>) => o.summary.totalSessions },
  { id: "tokens", label: "Total Tokens", icon: Coins, getValue: (o: NonNullable<ReturnType<typeof useDashboardStore.getState>["overview"]>) => o.summary.totalTokens },
  { id: "savings", label: "Est. Savings", icon: TrendingUp, getValue: (o: NonNullable<ReturnType<typeof useDashboardStore.getState>["overview"]>) => o.summary.estimatedSavings },
  { id: "reads", label: "Total Reads", icon: BookOpen, getValue: (o: NonNullable<ReturnType<typeof useDashboardStore.getState>["overview"]>) => o.summary.totalReads },
  { id: "writes", label: "Total Writes", icon: PenLine, getValue: (o: NonNullable<ReturnType<typeof useDashboardStore.getState>["overview"]>) => o.summary.totalWrites },
];

export function OverviewPanel() {
  const overview = useDashboardStore((s) => s.overview);
  const fileIndex = useDashboardStore((s) => s.fileIndex);
  const health = useDashboardStore((s) => s.health);

  if (!overview) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Daemon Status */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-sm font-medium">
            <div className="flex items-center gap-2">
              <Server className="h-4 w-4" />
              Daemon Status
            </div>
          </CardTitle>
          <Badge variant={overview.daemon.running ? "default" : "destructive"}>
            {overview.daemon.running ? "running" : "offline"}
          </Badge>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {overview.daemon.running && health
              ? `Uptime: ${formatUptime(health.uptimeMs)}`
              : "Start with: mink daemon start"}
          </p>
        </CardContent>
      </Card>

      {/* Summary Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {statCards.map((stat) => (
          <Card key={stat.id}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {stat.label}
              </CardTitle>
              <stat.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {formatNum(stat.getValue(overview))}
              </div>
            </CardContent>
          </Card>
        ))}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Indexed Files
            </CardTitle>
            <FolderOpen className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatNum(fileIndex?.header?.totalFiles ?? 0)}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* State File Health */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">State File Health</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {overview.stateFiles.map((file) => (
              <div
                key={file.name}
                className="flex items-center justify-between rounded-md border px-3 py-2"
              >
                <span className="text-xs font-mono truncate mr-2">{file.name}</span>
                <Badge
                  variant={
                    file.status === "ok"
                      ? "default"
                      : file.status === "missing"
                        ? "secondary"
                        : "destructive"
                  }
                  className="text-[10px]"
                >
                  {file.status}
                </Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
