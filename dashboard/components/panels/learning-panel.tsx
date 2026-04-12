"use client";

import { useDashboardStore } from "@/hooks/use-dashboard-store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Brain } from "lucide-react";

const SECTION_CONFIG = [
  { key: "User Preferences" as const, label: "User Preferences" },
  { key: "Key Learnings" as const, label: "Key Learnings" },
  { key: "Do-Not-Repeat" as const, label: "Do-Not-Repeat" },
  { key: "Decision Log" as const, label: "Decision Log" },
];

export function LearningPanel() {
  const learningMemory = useDashboardStore((s) => s.learningMemory);

  if (!learningMemory) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-16" />
        ))}
      </div>
    );
  }

  const sections = learningMemory.sections ?? {};

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Brain className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">
          {learningMemory.projectName || "Unknown Project"}
        </span>
      </div>

      <Accordion type="multiple" defaultValue={SECTION_CONFIG.map((s) => s.key)}>
        {SECTION_CONFIG.map((section) => {
          const items = sections[section.key] ?? [];
          return (
            <AccordionItem key={section.key} value={section.key}>
              <AccordionTrigger className="text-sm">
                <div className="flex items-center gap-2">
                  {section.label}
                  <Badge variant="secondary" className="text-[10px]">
                    {items.length}
                  </Badge>
                </div>
              </AccordionTrigger>
              <AccordionContent>
                {items.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-2">
                    No entries yet
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {items.map((item, i) => (
                      <li
                        key={i}
                        className="text-sm py-1 border-b border-border/50 last:border-0"
                      >
                        {item}
                      </li>
                    ))}
                  </ul>
                )}
              </AccordionContent>
            </AccordionItem>
          );
        })}
      </Accordion>
    </div>
  );
}
