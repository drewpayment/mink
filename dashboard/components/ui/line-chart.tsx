export interface LinePoint {
  x: string | number;
  y: number;
}

export interface LineSeries {
  name: string;
  color: string;
  data: LinePoint[];
  fill?: boolean;
}

interface LineChartProps {
  series: LineSeries[];
  width?: number;
  height?: number;
}

export function LineChart({ series, width = 720, height = 180 }: LineChartProps) {
  if (!series.length || !series[0].data.length) {
    return (
      <div className="empty" style={{ height, display: "grid", placeItems: "center" }}>
        <div>
          <h4>No data yet</h4>
          <span>chart will populate when sessions arrive</span>
        </div>
      </div>
    );
  }

  const xs = series[0].data.map((d) => d.x);
  const allY = series.flatMap((s) => s.data.map((d) => d.y));
  const maxY = Math.max(...allY) * 1.15 || 1;
  const minY = 0;
  const pad = { l: 36, r: 12, t: 14, b: 24 };
  const W = width - pad.l - pad.r;
  const H = height - pad.t - pad.b;
  const xAt = (i: number) => pad.l + (xs.length === 1 ? W / 2 : (i / (xs.length - 1)) * W);
  const yAt = (v: number) => pad.t + H - ((v - minY) / (maxY - minY || 1)) * H;

  const gridY = 4;
  const gridLines = Array.from({ length: gridY + 1 }, (_, i) => {
    const v = minY + ((maxY - minY) / gridY) * i;
    return { v, y: yAt(v) };
  });

  return (
    <svg width={width} height={height} style={{ display: "block", maxWidth: "100%" }}>
      {gridLines.map((g, i) => (
        <g key={i}>
          <line x1={pad.l} x2={width - pad.r} y1={g.y} y2={g.y} stroke="var(--line-1)" strokeDasharray="2 3" />
          <text
            x={pad.l - 6}
            y={g.y + 3}
            textAnchor="end"
            fontSize="9"
            fontFamily="var(--font-mono), monospace"
            fill="var(--fg-3)"
          >
            {Math.round(g.v)}k
          </text>
        </g>
      ))}
      {xs.map((x, i) => (
        <text
          key={i}
          x={xAt(i)}
          y={height - 6}
          textAnchor="middle"
          fontSize="9"
          fontFamily="var(--font-mono), monospace"
          fill="var(--fg-3)"
        >
          {x}
        </text>
      ))}
      {series.map((s, si) => {
        const path = s.data
          .map((d, i) => `${i === 0 ? "M" : "L"}${xAt(i)},${yAt(d.y)}`)
          .join(" ");
        const area = `${path} L${xAt(s.data.length - 1)},${yAt(0)} L${xAt(0)},${yAt(0)} Z`;
        return (
          <g key={si}>
            {s.fill && <path d={area} fill={s.color} opacity="0.12" />}
            <path
              d={path}
              fill="none"
              stroke={s.color}
              strokeWidth="1.6"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            {s.data.map((d, i) => (
              <circle
                key={i}
                cx={xAt(i)}
                cy={yAt(d.y)}
                r="2"
                fill="var(--bg-0)"
                stroke={s.color}
                strokeWidth="1.4"
              />
            ))}
          </g>
        );
      })}
    </svg>
  );
}
