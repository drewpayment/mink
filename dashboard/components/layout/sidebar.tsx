"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/ui/icon";
import { useDashboardStore } from "@/hooks/use-dashboard-store";
import { ProjectSwitcherMenu } from "./project-switcher-menu";

interface NavItem {
  id: string;
  href: string;
  label: string;
  icon: IconName;
  countKey?: "capture" | "waste" | "bugs" | "scheduler";
  showDot?: boolean;
}

interface NavGroup {
  group: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    group: "Overview",
    items: [
      { id: "sessions", href: "/overview", label: "Sessions",      icon: "activity", showDot: true },
      { id: "activity", href: "/activity", label: "Activity log",  icon: "pulse" },
      { id: "tokens",   href: "/tokens",   label: "Token ledger",  icon: "chart" },
      { id: "compression", href: "/compression", label: "Compression", icon: "chart" },
      { id: "waste",    href: "/waste",    label: "Waste detect",  icon: "alert", countKey: "waste" },
    ],
  },
  {
    group: "Knowledge",
    items: [
      { id: "files",  href: "/file-index", label: "File index", icon: "file"  },
      { id: "memory", href: "/learning",   label: "Learning",   icon: "brain" },
      { id: "bugs",   href: "/bugs",       label: "Bug memory", icon: "bug",   countKey: "bugs" },
    ],
  },
  {
    group: "Notes & Wiki",
    items: [
      { id: "wiki",    href: "/wiki",    label: "Vault",   icon: "book" },
      { id: "capture", href: "/capture", label: "Capture", icon: "plus", countKey: "capture" },
    ],
  },
  {
    group: "Operations",
    items: [
      { id: "scheduler", href: "/scheduler", label: "Scheduler", icon: "clock",  countKey: "scheduler" },
      { id: "discord",   href: "/discord",   label: "Discord",   icon: "discord" },
      { id: "sync",      href: "/sync",      label: "Sync",      icon: "git" },
    ],
  },
  {
    group: "System",
    items: [
      { id: "daemon", href: "/daemon", label: "Daemon",        icon: "power" },
      { id: "config", href: "/config", label: "Configuration", icon: "settings" },
    ],
  },
];

export function crumbFor(pathname: string): { group: string; label: string } {
  for (const g of NAV) {
    for (const it of g.items) {
      const match = it.href === pathname || (it.href === "/overview" && pathname === "/");
      if (match) return { group: g.group, label: it.label };
    }
  }
  return { group: "Overview", label: "Sessions" };
}

export function Sidebar() {
  const pathname = usePathname();
  const [showMenu, setShowMenu] = useState(false);
  const activeProjectId = useDashboardStore((s) => s.activeProjectId);
  const projects = useDashboardStore((s) => s.projects);
  const overviewProjectName = useDashboardStore((s) => s.overview?.project?.name);

  const wasteCount = useDashboardStore((s) => s.wasteFlags.length);
  const bugsCount = useDashboardStore((s) =>
    s.bugs.filter((b) => !b.fixDescription?.trim()).length,
  );
  const schedulerDlqCount = useDashboardStore((s) => s.deadLetters.length);
  const daemonRunning = useDashboardStore((s) => s.overview?.daemon?.running ?? false);

  const counts: Record<NonNullable<NavItem["countKey"]>, number> = {
    capture: 0,
    waste: wasteCount,
    bugs: bugsCount,
    scheduler: schedulerDlqCount,
  };

  const activeProject = projects.find((p) => p.id === activeProjectId);
  const projectName = activeProject?.name || overviewProjectName || "Mink";
  const projectSlug = activeProject?.id || activeProject?.cwd || "";

  return (
    <aside className="sidebar">
      <div className="sb-head">
        <div className="sb-logo">M</div>
        <div className="sb-title">Mink</div>
        <div className="sb-sub">v1</div>
      </div>

      <div className="sb-project" onClick={() => setShowMenu((v) => !v)}>
        <Icon name="folder" size={13} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="pname">{projectName}</div>
          <div className="pslug">{projectSlug}</div>
        </div>
        <Icon name="chevDown" size={12} className="pchev" />
      </div>

      {NAV.map((g) => (
        <div key={g.group}>
          <div className="sb-group">{g.group}</div>
          {g.items.map((it) => {
            const active =
              pathname === it.href || (it.href === "/overview" && pathname === "/");
            const count = it.countKey ? counts[it.countKey] : 0;
            return (
              <Link
                key={it.id}
                href={it.href}
                aria-current={active ? "page" : undefined}
                className={`sb-item ${active ? "active" : ""}`.trim()}
              >
                <Icon name={it.icon} size={13} />
                <span>{it.label}</span>
                {it.showDot && daemonRunning && <span className="dot" />}
                {count > 0 && <span className="count">{count}</span>}
              </Link>
            );
          })}
        </div>
      ))}

      <div style={{ height: 20 }} />

      {showMenu && (
        <ProjectSwitcherMenu onClose={() => setShowMenu(false)} />
      )}
    </aside>
  );
}
