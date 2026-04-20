type Tone = "" | "accent" | "red";

interface SparkProps {
  data: number[];
  width?: number;
  height?: number;
  tone?: Tone;
}

export function Spark({ data, width = 60, height = 22, tone = "" }: SparkProps) {
  if (!data.length) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const points = data
    .map((v, i) => {
      const x = data.length === 1 ? 0 : (i / (data.length - 1)) * width;
      const y = height - ((v - min) / span) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const color =
    tone === "accent" ? "var(--accent)" : tone === "red" ? "var(--red)" : "var(--fg-2)";
  return (
    <svg width={width} height={height} className="spark">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
