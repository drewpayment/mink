"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";
import { StatusBar } from "./status-bar";
import { Rail } from "./rail";
import { Tweaks } from "./tweaks";
import { Onboarding } from "./onboarding";
import { usePreferences } from "@/hooks/use-preferences";
import { useDashboardStore } from "@/hooks/use-dashboard-store";

const RAIL_ROUTES = new Set([
  "/",
  "/overview",
  "/activity",
  "/tokens",
  "/waste",
  "/scheduler",
  "/daemon",
]);

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { resolvedTheme } = useTheme();

  const accent = usePreferences((s) => s.accent);
  const density = usePreferences((s) => s.density);
  const liveFeel = usePreferences((s) => s.liveFeel);

  const online = useDashboardStore((s) => s.overview?.daemon?.running ?? false);
  const hasOverview = useDashboardStore((s) => s.overview != null);

  // Sync preferences to <body> data-attrs so CSS tokens cascade.
  useEffect(() => {
    const body = document.body;
    body.dataset.theme = resolvedTheme === "light" ? "light" : "dark";
    body.dataset.accent = accent;
    body.dataset.density = density;
    body.dataset.live = liveFeel ? "on" : "off";
    body.dataset.daemon = online ? "online" : "offline";
  }, [resolvedTheme, accent, density, liveFeel, online]);

  const railVisible = online && RAIL_ROUTES.has(pathname ?? "/");
  // Show onboarding only on the overview route when daemon state is offline
  // AND we've already heard from the API (so we don't flash it while loading).
  const showOnboarding = !online && hasOverview && (pathname === "/" || pathname === "/overview");

  return (
    <>
      <div id="app-root">
        <div className={`shell ${railVisible ? "with-rail" : ""}`.trim()}>
          <Sidebar />
          <TopBar />
          <main className="main">{showOnboarding ? <Onboarding /> : children}</main>
          {railVisible && <Rail />}
          <StatusBar />
        </div>
      </div>
      <Tweaks />
    </>
  );
}
