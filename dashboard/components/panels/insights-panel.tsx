"use client";

import { useDashboardStore } from "@/hooks/use-dashboard-store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatNum } from "@/lib/format";
import { Lightbulb, AlertTriangle } from "lucide-react";
import type { WastePattern } from "@mink/types/waste-detection";

function patternLabel(pattern: WastePattern): string {
  switch (pattern) {
    case "repeated-reads":
      return "Repeated Reads";
    case "missed-index-opportunity":
      return "Missed Index";
    case "action-log-bloat":
      return "Log Bloat";
    case "learning-memory-staleness":
      return "Stale Memory";
    case "index-miss-rate":
      return "High Miss Rate";
    default:
      return pattern;
  }
}

export function InsightsPanel() {
  const wasteFlags = useDashboardStore((s) => s.wasteFlags);
  const ledger = useDashboardStore((s) => s.ledger);

  if (!ledger) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32" />
      </div>
    );
  }

  const totalWasted = wasteFlags.reduce(
    (sum, f) => sum + f.estimatedTokensWasted,
    0
  );

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <div className="flex items-center gap-1">
          <Lightbulb className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground">Active Flags:</span>
          <span className="font-medium">{wasteFlags.length}</span>
        </div>
        {totalWasted > 0 && (
          <div>
            <span className="text-muted-foreground">Est. Tokens Wasted:</span>{" "}
            <span className="font-medium text-destructive">{formatNum(totalWasted)}</span>
          </div>
        )}
      </div>

      {wasteFlags.length === 0 ? (
        <Card>
          <CardContent className="py-8">
            <div className="text-center">
              <Lightbulb className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">
                No waste patterns detected. Run waste detection to analyze token usage.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {wasteFlags.map((flag, i) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-yellow-500" />
                    {patternLabel(flag.pattern)}
                  </CardTitle>
                  <Badge variant="destructive" className="text-[10px]">
                    ~{formatNum(flag.estimatedTokensWasted)} wasted
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm">{flag.description}</p>
                <p className="text-xs text-muted-foreground mt-2">
                  {flag.suggestion}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
