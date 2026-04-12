"use client";

import { useState, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useDashboardStore, type ActionLogRow } from "@/hooks/use-dashboard-store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, ScrollText } from "lucide-react";

const ACTION_TYPES = ["All", "Read", "Write", "Create", "Edit"] as const;

function actionBadgeVariant(action: string) {
  switch (action.toLowerCase()) {
    case "read":
      return "default" as const;
    case "write":
    case "edit":
      return "secondary" as const;
    case "create":
      return "outline" as const;
    default:
      return "outline" as const;
  }
}

export function ActionLogPanel() {
  const actionLog = useDashboardStore((s) => s.actionLog);
  const [query, setQuery] = useState("");
  const [actionFilter, setActionFilter] = useState<string>("All");
  const parentRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    let result = actionLog;
    if (actionFilter !== "All") {
      result = result.filter(
        (e) => e.action.toLowerCase() === actionFilter.toLowerCase()
      );
    }
    if (query.trim()) {
      const lower = query.toLowerCase();
      result = result.filter(
        (e) =>
          e.files.toLowerCase().includes(lower) ||
          e.outcome.toLowerCase().includes(lower) ||
          e.action.toLowerCase().includes(lower)
      );
    }
    return result;
  }, [actionLog, query, actionFilter]);

  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 44,
    overscan: 15,
  });

  if (!actionLog.length && !useDashboardStore.getState().connected) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <ScrollText className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm text-muted-foreground">
          {actionLog.length} entries
        </span>
      </div>

      {/* Search & Filter */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search actions..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex gap-1">
          {ACTION_TYPES.map((type) => (
            <button
              key={type}
              onClick={() => setActionFilter(type)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                actionFilter === type
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-secondary-foreground hover:bg-accent"
              }`}
            >
              {type}
            </button>
          ))}
        </div>
      </div>

      <p className="text-xs text-muted-foreground">{filtered.length} results</p>

      {/* Virtualized Table */}
      <div className="rounded-md border">
        {/* Header */}
        <div className="grid grid-cols-[60px_80px_1fr_1fr_80px] gap-2 border-b bg-muted/50 px-4 py-2 text-xs font-medium text-muted-foreground">
          <span>Time</span>
          <span>Action</span>
          <span>File(s)</span>
          <span>Outcome</span>
          <span className="text-right">~Tokens</span>
        </div>

        <div
          ref={parentRef}
          className="h-[500px] overflow-auto"
        >
          {filtered.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No matching entries
            </div>
          ) : (
            <div
              style={{
                height: `${virtualizer.getTotalSize()}px`,
                width: "100%",
                position: "relative",
              }}
            >
              {virtualizer.getVirtualItems().map((virtualRow) => {
                const entry = filtered[virtualRow.index];
                return (
                  <div
                    key={virtualRow.key}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      height: `${virtualRow.size}px`,
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                    className="grid grid-cols-[60px_80px_1fr_1fr_80px] gap-2 items-center border-b px-4 text-xs"
                  >
                    <span className="font-mono">{entry.time}</span>
                    <span>
                      <Badge
                        variant={actionBadgeVariant(entry.action)}
                        className="text-[10px]"
                      >
                        {entry.action}
                      </Badge>
                    </span>
                    <span className="truncate font-mono">{entry.files}</span>
                    <span className="truncate text-muted-foreground">
                      {entry.outcome}
                    </span>
                    <span className="text-right font-mono">{entry.tokens}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
