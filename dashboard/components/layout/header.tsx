"use client";

import { useTheme } from "next-themes";
import { Sun, Moon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConnectionIndicator } from "./connection-indicator";
import { ProjectSwitcher } from "./project-switcher";

export function Header() {
  const { theme, setTheme } = useTheme();

  return (
    <header className="flex h-12 items-center justify-between border-b border-border bg-card px-4">
      <div className="flex items-center gap-3">
        <ProjectSwitcher />
      </div>
      <div className="flex items-center gap-4">
        <ConnectionIndicator />
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        >
          <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
          <span className="sr-only">Toggle theme</span>
        </Button>
      </div>
    </header>
  );
}
