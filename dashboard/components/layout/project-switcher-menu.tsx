"use client";

import { useDashboardStore } from "@/hooks/use-dashboard-store";
import { switchProject } from "@/lib/api-client";
import { fetchAllData } from "@/hooks/use-sse";
import { Icon } from "@/components/ui/icon";
import { Btn } from "@/components/ui/btn";

function truncatePath(cwd: string, maxLen = 36): string {
  if (cwd.length <= maxLen) return cwd;
  return "..." + cwd.slice(cwd.length - maxLen + 3);
}

interface Props {
  onClose: () => void;
}

export function ProjectSwitcherMenu({ onClose }: Props) {
  const projects = useDashboardStore((s) => s.projects);
  const activeProjectId = useDashboardStore((s) => s.activeProjectId);
  const setActiveProject = useDashboardStore((s) => s.setActiveProject);

  async function handleSwitch(id: string) {
    if (id === activeProjectId) {
      onClose();
      return;
    }
    setActiveProject(id);
    await switchProject(id);
    fetchAllData();
    onClose();
  }

  return (
    <div
      role="menu"
      onMouseLeave={onClose}
      style={{
        position: "fixed",
        top: 92,
        left: 12,
        width: 320,
        zIndex: 80,
        background: "var(--bg-1)",
        border: "1px solid var(--line-1)",
        borderRadius: 10,
        boxShadow: "var(--shadow-pop)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "8px 12px",
          borderBottom: "1px solid var(--line-1)",
          fontSize: 10.5,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "var(--fg-3)",
          fontWeight: 600,
        }}
      >
        Projects · {projects.length}
      </div>
      {projects.map((p) => (
        <div
          key={p.id}
          role="menuitem"
          onClick={() => handleSwitch(p.id)}
          className="row"
          style={{
            padding: "8px 12px",
            cursor: "pointer",
            background: activeProjectId === p.id ? "var(--bg-2)" : undefined,
            borderBottom: "1px solid var(--line-1)",
          }}
        >
          <Icon name="folder" size={12} />
          <div style={{ flex: 1, minWidth: 0, marginLeft: 8 }}>
            <div style={{ color: "var(--fg-0)", fontSize: 12 }}>{p.name}</div>
            <div className="mono muted" style={{ fontSize: 10 }}>
              {truncatePath(p.cwd)}
            </div>
          </div>
          {activeProjectId === p.id && (
            <span
              className="dot"
              style={{
                width: 6,
                height: 6,
                borderRadius: 3,
                background: "var(--accent)",
              }}
            />
          )}
        </div>
      ))}
      {projects.length === 0 && (
        <div className="empty" style={{ padding: 16 }}>
          <div>No projects registered</div>
        </div>
      )}
      <div style={{ padding: 8, background: "var(--bg-2)" }}>
        <Btn size="sm" icon="plus" variant="ghost" disabled title="Preview — run `mink init` in a repo">
          Add project
        </Btn>
      </div>
    </div>
  );
}
