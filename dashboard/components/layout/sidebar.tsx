"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Activity,
  Coins,
  CalendarClock,
  Brain,
  ScrollText,
  FolderSearch,
  Bug,
  Lightbulb,
  Image,
} from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/overview", label: "Overview", icon: LayoutDashboard },
  { href: "/activity", label: "Activity", icon: Activity },
  { href: "/tokens", label: "Token Intelligence", icon: Coins },
  { href: "/scheduler", label: "Scheduler", icon: CalendarClock },
  { href: "/learning", label: "Learning Memory", icon: Brain },
  { href: "/action-log", label: "Action Log", icon: ScrollText },
  { href: "/file-index", label: "File Index", icon: FolderSearch },
  { href: "/bugs", label: "Bug Log", icon: Bug },
  { href: "/insights", label: "AI Insights", icon: Lightbulb },
  { href: "/design", label: "Design Eval", icon: Image },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex h-full w-56 flex-col border-r border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-4 py-4">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground text-sm font-bold">
          M
        </div>
        <span className="text-sm font-semibold tracking-tight">Mink</span>
      </div>
      <nav className="flex-1 overflow-y-auto px-2 py-2">
        {navItems.map((item) => {
          const active = pathname === item.href || (item.href === "/overview" && pathname === "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                active
                  ? "bg-accent text-accent-foreground font-medium"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              )}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              <span className="truncate">{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
