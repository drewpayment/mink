"use client";

import { useState, useMemo, useRef, useCallback } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useDashboardStore } from "@/hooks/use-dashboard-store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { formatNum, formatDateTime } from "@/lib/format";
import { FolderOpen, Search } from "lucide-react";
import type { FileIndexEntry } from "@mink/types/file-index";

export function FileIndexPanel() {
  const fileIndex = useDashboardStore((s) => s.fileIndex);
  const [query, setQuery] = useState("");
  const [dirFilter, setDirFilter] = useState("");
  const parentRef = useRef<HTMLDivElement>(null);

  const searchFields = useCallback(
    (item: FileIndexEntry) => [item.filePath, item.description],
    []
  );

  const entries = fileIndex?.entries ?? [];

  const directories = useMemo(() => {
    const dirs = new Set<string>();
    for (const entry of entries) {
      const parts = entry.filePath.split("/");
      if (parts.length > 1) {
        dirs.add(parts.slice(0, -1).join("/"));
      }
    }
    return Array.from(dirs).sort();
  }, [entries]);

  const filtered = useMemo(() => {
    let result = entries;
    if (dirFilter) {
      result = result.filter((e) => e.filePath.startsWith(dirFilter + "/") || e.filePath.startsWith(dirFilter));
    }
    if (query.trim()) {
      const lower = query.toLowerCase();
      result = result.filter((item) =>
        searchFields(item).some((field) => field.toLowerCase().includes(lower))
      );
    }
    return result;
  }, [entries, query, dirFilter, searchFields]);

  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 72,
    overscan: 10,
  });

  if (!fileIndex) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  const header = fileIndex.header;
  const hitRate =
    (header.lifetimeHits + header.lifetimeMisses) > 0
      ? ((header.lifetimeHits / (header.lifetimeHits + header.lifetimeMisses)) * 100).toFixed(1)
      : "\u2014";

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="flex flex-wrap gap-4 text-sm">
        <div className="flex items-center gap-1">
          <FolderOpen className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground">Indexed:</span>
          <span className="font-medium">{formatNum(header.totalFiles)}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Last Scan:</span>{" "}
          <span className="font-medium">{formatDateTime(header.lastScanTimestamp)}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Hit Ratio:</span>{" "}
          <span className="font-medium">{hitRate}%</span>
        </div>
      </div>

      {/* Search & Filter */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search files..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <select
          value={dirFilter}
          onChange={(e) => setDirFilter(e.target.value)}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          <option value="">All directories</option>
          {directories.map((dir) => (
            <option key={dir} value={dir}>
              {dir}
            </option>
          ))}
        </select>
      </div>

      <p className="text-xs text-muted-foreground">{filtered.length} files</p>

      {/* Virtualized List */}
      <div
        ref={parentRef}
        className="h-[500px] overflow-auto rounded-md border"
      >
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
                className="flex items-center justify-between border-b px-4 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-mono truncate">{entry.filePath}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {entry.description}
                  </p>
                </div>
                <div className="ml-4 shrink-0 text-right">
                  <Badge variant="outline" className="text-[10px]">
                    ~{formatNum(entry.estimatedTokens)} tok
                  </Badge>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
