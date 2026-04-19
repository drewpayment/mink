import type { ReactNode } from "react";

type Tone = "" | "accent" | "red" | "amber" | "blue" | "violet";

interface ChipProps {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}

export function Chip({ tone = "", children, className = "" }: ChipProps) {
  return <span className={`chip ${tone} ${className}`.trim()}>{children}</span>;
}
