"use client";

import { useDashboardStore } from "@/hooks/use-dashboard-store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatNum } from "@/lib/format";
import { TokenBarChart } from "@/components/charts/token-bar-chart";
import { ReadWriteDonut } from "@/components/charts/read-write-donut";
import { CumulativeLineChart } from "@/components/charts/cumulative-line-chart";
import { Coins, TrendingUp, BarChart3, Activity } from "lucide-react";

export function TokenPanel() {
  const ledger = useDashboardStore((s) => s.ledger);

  if (!ledger) {
    return (
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  const lt = ledger.lifetime;
  const sessions = ledger.sessions ?? [];
  const total = (lt.totalReads ?? 0) + (lt.totalWrites ?? 0);
  const readPct = total > 0 ? ((lt.totalReads / total) * 100).toFixed(0) : "\u2014";
  const writePct = total > 0 ? ((lt.totalWrites / total) * 100).toFixed(0) : "\u2014";

  return (
    <div className="space-y-6">
      {/* Stat Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Lifetime Tokens
            </CardTitle>
            <Coins className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatNum(lt.totalTokens ?? 0)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Est. Savings
            </CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatNum(lt.totalEstimatedSavings ?? 0)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Read / Write Ratio
            </CardTitle>
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{readPct}% / {writePct}%</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Sessions Tracked
            </CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{lt.totalSessions ?? 0}</div>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid gap-6 lg:grid-cols-2">
        <TokenBarChart sessions={sessions} />
        <ReadWriteDonut reads={lt.totalReads ?? 0} writes={lt.totalWrites ?? 0} />
      </div>

      <CumulativeLineChart sessions={sessions} />
    </div>
  );
}
