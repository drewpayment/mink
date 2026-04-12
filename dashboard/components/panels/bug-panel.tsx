"use client";

import { useState, useMemo, useCallback } from "react";
import { useDashboardStore } from "@/hooks/use-dashboard-store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Bug, Search } from "lucide-react";
import { formatDateTime } from "@/lib/format";
import type { BugEntry } from "@mink/types/bug-memory";

export function BugPanel() {
  const bugs = useDashboardStore((s) => s.bugs);
  const [query, setQuery] = useState("");
  const [tagFilter, setTagFilter] = useState("");

  const allTags = useMemo(() => {
    const tags = new Set<string>();
    for (const bug of bugs) {
      for (const tag of bug.tags) tags.add(tag);
    }
    return Array.from(tags).sort();
  }, [bugs]);

  const searchFields = useCallback(
    (item: BugEntry) => [
      item.errorMessage,
      item.rootCause,
      item.fixDescription,
      item.filePath,
      ...item.tags,
    ],
    []
  );

  const filtered = useMemo(() => {
    let result = bugs;
    if (tagFilter) {
      result = result.filter((b) => b.tags.includes(tagFilter));
    }
    if (query.trim()) {
      const lower = query.toLowerCase();
      result = result.filter((item) =>
        searchFields(item).some((field) => field.toLowerCase().includes(lower))
      );
    }
    return result;
  }, [bugs, query, tagFilter, searchFields]);

  const totalOccurrences = bugs.reduce((sum, b) => sum + b.occurrenceCount, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <div className="flex items-center gap-1">
          <Bug className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground">Bugs:</span>
          <span className="font-medium">{bugs.length}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Total Occurrences:</span>{" "}
          <span className="font-medium">{totalOccurrences}</span>
        </div>
      </div>

      {/* Search & Tag Filter */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search bugs..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        {allTags.length > 0 && (
          <select
            value={tagFilter}
            onChange={(e) => setTagFilter(e.target.value)}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="">All tags</option>
            {allTags.map((tag) => (
              <option key={tag} value={tag}>
                {tag}
              </option>
            ))}
          </select>
        )}
      </div>

      {filtered.length === 0 ? (
        <Card>
          <CardContent className="py-8">
            <p className="text-sm text-muted-foreground text-center">
              {bugs.length === 0 ? "No bugs recorded" : "No matching bugs"}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Accordion type="multiple">
          {filtered.map((bug) => (
            <AccordionItem key={bug.id} value={bug.id}>
              <AccordionTrigger className="text-sm text-left">
                <div className="flex flex-1 items-start justify-between pr-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate">{bug.errorMessage}</p>
                    <p className="text-xs text-muted-foreground font-mono truncate">
                      {bug.filePath}
                      {bug.lineNumber != null && `:${bug.lineNumber}`}
                    </p>
                  </div>
                  <div className="ml-2 flex shrink-0 items-center gap-1">
                    <Badge variant="outline" className="text-[10px]">
                      {bug.occurrenceCount}x
                    </Badge>
                    {bug.tags.map((tag) => (
                      <Badge key={tag} variant="secondary" className="text-[10px]">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-2 text-sm">
                  <div>
                    <span className="font-medium text-muted-foreground">Root Cause:</span>{" "}
                    {bug.rootCause}
                  </div>
                  <div>
                    <span className="font-medium text-muted-foreground">Fix:</span>{" "}
                    {bug.fixDescription}
                  </div>
                  <div className="flex gap-4 text-xs text-muted-foreground">
                    <span>Created: {formatDateTime(bug.createdAt)}</span>
                    <span>Last Seen: {formatDateTime(bug.lastSeenAt)}</span>
                  </div>
                  {bug.relatedBugIds.length > 0 && (
                    <div className="text-xs text-muted-foreground">
                      Related: {bug.relatedBugIds.join(", ")}
                    </div>
                  )}
                </div>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      )}
    </div>
  );
}
