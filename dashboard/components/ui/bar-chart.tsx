export interface BarDatum {
  label: string;
  value: number;
  color?: string;
}

interface BarChartProps {
  bars: BarDatum[];
  width?: number;
  height?: number;
}

export function BarChart({ bars, width = 720, height = 140 }: BarChartProps) {
  if (!bars.length) {
    return (
      <div className="empty" style={{ height, display: "grid", placeItems: "center" }}>
        <div><h4>No data yet</h4></div>
      </div>
    );
  }
  const pad = { l: 36, r: 12, t: 10, b: 22 };
  const W = width - pad.l - pad.r;
  const H = height - pad.t - pad.b;
  const maxY = Math.max(...bars.map((b) => b.value)) * 1.15 || 1;
  const bw = (W / bars.length) * 0.62;
  const gap = W / bars.length - bw;

  return (
    <svg width={width} height={height} style={{ display: "block", maxWidth: "100%" }}>
      {[0, 0.25, 0.5, 0.75, 1].map((f, i) => (
        <line
          key={i}
          x1={pad.l}
          x2={width - pad.r}
          y1={pad.t + H - f * H}
          y2={pad.t + H - f * H}
          stroke="var(--line-1)"
          strokeDasharray="2 3"
        />
      ))}
      {bars.map((b, i) => {
        const bh = (b.value / maxY) * H;
        const x = pad.l + i * (bw + gap) + gap / 2;
        const y = pad.t + H - bh;
        return (
          <g key={i}>
            <rect x={x} y={y} width={bw} height={bh} rx="2" fill={b.color || "var(--accent)"} opacity="0.85" />
            <text
              x={x + bw / 2}
              y={height - 6}
              textAnchor="middle"
              fontSize="9"
              fontFamily="var(--font-mono), monospace"
              fill="var(--fg-3)"
            >
              {b.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
