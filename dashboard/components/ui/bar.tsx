type Tone = "" | "red" | "amber";

interface BarProps {
  value: number;
  max?: number;
  tone?: Tone;
  className?: string;
}

export function Bar({ value, max = 100, tone = "", className = "" }: BarProps) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className={`bar ${tone} ${className}`.trim()}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}
