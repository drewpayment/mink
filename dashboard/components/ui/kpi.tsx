import type { ReactNode } from "react";
import { Spark } from "./spark";

type DeltaTone = "" | "up" | "down";
type SparkTone = "" | "accent" | "red";

interface KpiProps {
  label: string;
  value: ReactNode;
  delta?: ReactNode;
  deltaTone?: DeltaTone;
  spark?: number[];
  sparkTone?: SparkTone;
  live?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export function Kpi({
  label,
  value,
  delta,
  deltaTone = "",
  spark,
  sparkTone,
  live,
  className = "",
  style,
}: KpiProps) {
  return (
    <div className={`kpi ${className}`.trim()} style={style}>
      <div className="label">{label}</div>
      <div className={`value mono ${live ? "live-num" : ""}`.trim()}>{value}</div>
      {delta && <div className={`delta ${deltaTone}`.trim()}>{delta}</div>}
      {spark && (
        <div className="spark">
          <Spark data={spark} tone={sparkTone} />
        </div>
      )}
    </div>
  );
}
