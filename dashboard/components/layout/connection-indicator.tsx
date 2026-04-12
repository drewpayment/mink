"use client";

import { useDashboardStore } from "@/hooks/use-dashboard-store";
import { cn } from "@/lib/utils";

export function ConnectionIndicator() {
  const connected = useDashboardStore((s) => s.connected);

  return (
    <div className="flex items-center gap-2 text-xs">
      <div
        className={cn(
          "h-2 w-2 rounded-full",
          connected ? "bg-green-500" : "bg-red-500 animate-pulse"
        )}
      />
      <span className="text-muted-foreground">
        {connected ? "Connected" : "Disconnected"}
      </span>
    </div>
  );
}
