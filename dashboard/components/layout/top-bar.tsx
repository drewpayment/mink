"use client";

import { usePathname } from "next/navigation";
import { useDashboardStore } from "@/hooks/use-dashboard-store";
import { usePreferences } from "@/hooks/use-preferences";
import { Icon } from "@/components/ui/icon";
import { crumbFor } from "./sidebar";

export function TopBar() {
  const pathname = usePathname();
  const online = useDashboardStore((s) => s.overview?.daemon?.running ?? false);
  const setTweaksOpen = usePreferences((s) => s.setTweaksOpen);
  const activeProject = useDashboardStore((s) =>
    s.projects.find((p) => p.id === s.activeProjectId),
  );
  const projectName = activeProject?.name ?? "Mink";

  const c = crumbFor(pathname || "/");

  return (
    <header className="topbar">
      <div className="tb-section">
        <span className="muted">{projectName}</span>
        <span className="sep">/</span>
        <span className="muted">{c.group}</span>
        <span className="sep">/</span>
        <span className="crumb">{c.label}</span>
      </div>

      <div className="tb-spacer" />

      <div className="cmdk" title="Command palette (coming soon)">
        <Icon name="search" size={12} />
        <span>Search files, notes, bugs…</span>
        <kbd>⌘K</kbd>
      </div>

      <span
        className="daemon-pill"
        title={`Daemon ${online ? "online" : "offline"}`}
      >
        <span className="pulse" />
        <span className="mono" style={{ fontSize: 10.5 }}>
          {online ? "daemon · online" : "daemon · offline"}
        </span>
      </span>

      <button type="button" className="tb-icon-btn" title="Refresh data" onClick={() => location.reload()}>
        <Icon name="refresh" size={13} />
      </button>
      <button
        type="button"
        className="tb-icon-btn"
        title="Tweaks"
        onClick={() => setTweaksOpen(true)}
      >
        <Icon name="wand" size={13} />
      </button>
      <button type="button" className="tb-icon-btn" title="More" aria-label="More">
        <Icon name="dots" size={14} />
      </button>
    </header>
  );
}
