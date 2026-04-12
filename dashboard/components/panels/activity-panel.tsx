"use client";

import { useDashboardStore } from "@/hooks/use-dashboard-store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatNum, formatDate, formatDateTime } from "@/lib/format";
import { Activity } from "lucide-react";

export function ActivityPanel() {
  const ledger = useDashboardStore((s) => s.ledger);

  if (!ledger) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
    );
  }

  const sessions = ledger.sessions ?? [];
  const sorted = [...sessions].reverse();

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">
            {sessions.length} sessions
          </span>
        </div>
        {sessions.length > 0 && (
          <span className="text-sm text-muted-foreground">
            Latest: {formatDate(sessions[sessions.length - 1].startTimestamp)}
          </span>
        )}
      </div>

      {sorted.length === 0 ? (
        <Card>
          <CardContent className="py-8">
            <p className="text-sm text-muted-foreground text-center">
              No sessions recorded yet
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {sorted.map((s) => {
            const reads = s.totals?.readCount ?? 0;
            const writes = s.totals?.writeCount ?? 0;
            const tokens = s.totals?.estimatedTokens ?? 0;
            const savings = s.estimatedSavings ?? 0;

            return (
              <Card key={s.sessionId}>
                <CardContent className="py-3 px-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-sm font-medium">
                        {formatDateTime(s.startTimestamp)}
                      </span>
                      <span className="text-xs text-muted-foreground ml-2">
                        {"\u2192"} {s.endTimestamp ? formatDateTime(s.endTimestamp) : "ongoing"}
                      </span>
                    </div>
                    <span className="text-xs font-medium text-primary">
                      {formatNum(tokens)} tokens
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {reads} reads {"\u00b7"} {writes} writes {"\u00b7"} {formatNum(savings)} saved
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
