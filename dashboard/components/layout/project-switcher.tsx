"use client";

import { useDashboardStore } from "@/hooks/use-dashboard-store";
import { switchProject } from "@/lib/api-client";
import { fetchAllData } from "@/hooks/use-sse";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

function truncatePath(cwd: string, maxLen = 40): string {
  if (cwd.length <= maxLen) return cwd;
  return "..." + cwd.slice(cwd.length - maxLen + 3);
}

export function ProjectSwitcher() {
  const projects = useDashboardStore((s) => s.projects);
  const activeProjectId = useDashboardStore((s) => s.activeProjectId);
  const projectName = useDashboardStore((s) => s.overview?.project?.name);
  const setActiveProject = useDashboardStore((s) => s.setActiveProject);

  // Still loading or single project — show static text
  if (projects.length <= 1) {
    return (
      <h1 className="text-sm font-medium">
        {projects[0]?.name ?? projectName ?? "Mink"}
      </h1>
    );
  }

  async function handleSwitch(newId: string) {
    if (newId === activeProjectId) return;
    setActiveProject(newId);
    await switchProject(newId);
    fetchAllData();
  }

  return (
    <Select value={activeProjectId ?? undefined} onValueChange={handleSwitch}>
      <SelectTrigger size="sm" className="border-none bg-transparent shadow-none gap-1.5">
        <SelectValue placeholder="Select project" />
      </SelectTrigger>
      <SelectContent>
        {projects.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            <div className="flex flex-col">
              <span>{p.name}</span>
              <span className="text-xs text-muted-foreground">
                {truncatePath(p.cwd)}
              </span>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
