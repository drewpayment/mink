/**
 * SVG chart generators: bar chart, line chart, donut chart.
 * All produce inline SVG strings inserted via innerHTML.
 */
export function jsCharts(): string {
  return `
// ── Chart Utilities ─────────────────────────────────────────
const Charts = (() => {
  function formatNum(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return String(n);
  }

  function scaleLinear(domain, range) {
    const [d0, d1] = domain;
    const [r0, r1] = range;
    const span = d1 - d0 || 1;
    return (v) => r0 + ((v - d0) / span) * (r1 - r0);
  }

  function renderBarChart(containerId, data, opts = {}) {
    const el = document.getElementById(containerId);
    if (!el || !data || data.length === 0) {
      if (el) el.innerHTML = '<div class="empty-state">No data</div>';
      return;
    }

    const width = 600;
    const height = 180;
    const pad = { top: 10, right: 10, bottom: 30, left: 50 };
    const chartW = width - pad.left - pad.right;
    const chartH = height - pad.top - pad.bottom;

    const maxVal = Math.max(...data.map(d => d.value)) || 1;
    const yScale = scaleLinear([0, maxVal], [chartH, 0]);
    const barW = Math.max(4, Math.min(30, (chartW / data.length) - 2));
    const gap = (chartW - barW * data.length) / (data.length + 1);

    const color = opts.color || 'var(--chart-primary)';

    // Grid lines
    const gridCount = 4;
    let gridLines = '';
    for (let i = 0; i <= gridCount; i++) {
      const y = pad.top + (chartH / gridCount) * i;
      const val = maxVal - (maxVal / gridCount) * i;
      gridLines += \`<line x1="\${pad.left}" y1="\${y}" x2="\${width - pad.right}" y2="\${y}" stroke="var(--chart-grid)" stroke-width="1"/>\`;
      gridLines += \`<text x="\${pad.left - 6}" y="\${y + 4}" text-anchor="end" fill="var(--chart-axis)" font-size="10">\${formatNum(val)}</text>\`;
    }

    // Bars
    let bars = '';
    data.forEach((d, i) => {
      const x = pad.left + gap + i * (barW + gap);
      const barH = chartH - yScale(d.value);
      const y = pad.top + yScale(d.value);
      bars += \`<rect x="\${x}" y="\${y}" width="\${barW}" height="\${barH}" rx="2" fill="\${color}" opacity="0.85"><title>\${d.label}: \${formatNum(d.value)}</title></rect>\`;
      // X-axis labels (show every Nth for readability)
      if (data.length <= 15 || i % Math.ceil(data.length / 15) === 0) {
        bars += \`<text x="\${x + barW / 2}" y="\${height - 4}" text-anchor="middle" fill="var(--chart-axis)" font-size="9">\${d.label}</text>\`;
      }
    });

    el.innerHTML = \`<svg viewBox="0 0 \${width} \${height}" preserveAspectRatio="xMidYMid meet">\${gridLines}\${bars}</svg>\`;
  }

  function renderLineChart(containerId, datasets, opts = {}) {
    const el = document.getElementById(containerId);
    if (!el || !datasets || datasets.length === 0) {
      if (el) el.innerHTML = '<div class="empty-state">No data</div>';
      return;
    }

    const width = 600;
    const height = 200;
    const pad = { top: 10, right: 10, bottom: 30, left: 50 };
    const chartW = width - pad.left - pad.right;
    const chartH = height - pad.top - pad.bottom;

    const allValues = datasets.flatMap(ds => ds.data.map(d => d.value));
    const maxVal = Math.max(...allValues) || 1;
    const yScale = scaleLinear([0, maxVal], [chartH, 0]);
    const colors = [
      'var(--chart-primary)',
      'var(--chart-secondary)',
      'var(--chart-tertiary)',
    ];

    // Grid
    const gridCount = 4;
    let gridLines = '';
    for (let i = 0; i <= gridCount; i++) {
      const y = pad.top + (chartH / gridCount) * i;
      const val = maxVal - (maxVal / gridCount) * i;
      gridLines += \`<line x1="\${pad.left}" y1="\${y}" x2="\${width - pad.right}" y2="\${y}" stroke="var(--chart-grid)" stroke-width="1"/>\`;
      gridLines += \`<text x="\${pad.left - 6}" y="\${y + 4}" text-anchor="end" fill="var(--chart-axis)" font-size="10">\${formatNum(val)}</text>\`;
    }

    // Lines
    let lines = '';
    datasets.forEach((ds, di) => {
      const pts = ds.data;
      if (pts.length === 0) return;
      const color = colors[di % colors.length];
      const xStep = pts.length > 1 ? chartW / (pts.length - 1) : 0;
      const pathPoints = pts.map((p, i) => {
        const x = pad.left + i * xStep;
        const y = pad.top + yScale(p.value);
        return \`\${x},\${y}\`;
      });

      // Area fill
      const firstX = pad.left;
      const lastX = pad.left + (pts.length - 1) * xStep;
      const baseline = pad.top + chartH;
      lines += \`<polygon points="\${firstX},\${baseline} \${pathPoints.join(' ')} \${lastX},\${baseline}" fill="\${color}" opacity="0.1"/>\`;

      // Line
      lines += \`<polyline points="\${pathPoints.join(' ')}" fill="none" stroke="\${color}" stroke-width="2"/>\`;

      // Dots
      pts.forEach((p, i) => {
        const x = pad.left + i * xStep;
        const y = pad.top + yScale(p.value);
        lines += \`<circle cx="\${x}" cy="\${y}" r="3" fill="\${color}"><title>\${p.label}: \${formatNum(p.value)}</title></circle>\`;
      });

      // X-axis labels
      if (di === 0) {
        pts.forEach((p, i) => {
          if (pts.length <= 15 || i % Math.ceil(pts.length / 15) === 0) {
            const x = pad.left + i * xStep;
            lines += \`<text x="\${x}" y="\${height - 4}" text-anchor="middle" fill="var(--chart-axis)" font-size="9">\${p.label}</text>\`;
          }
        });
      }
    });

    // Legend
    let legend = '';
    datasets.forEach((ds, di) => {
      const x = pad.left + di * 120;
      const color = colors[di % colors.length];
      legend += \`<rect x="\${x}" y="0" width="10" height="10" rx="2" fill="\${color}"/>\`;
      legend += \`<text x="\${x + 14}" y="9" fill="var(--chart-axis)" font-size="10">\${ds.label}</text>\`;
    });

    el.innerHTML = \`<svg viewBox="0 0 \${width} \${height}" preserveAspectRatio="xMidYMid meet">\${legend}\${gridLines}\${lines}</svg>\`;
  }

  function renderDonutChart(containerId, segments, opts = {}) {
    const el = document.getElementById(containerId);
    if (!el || !segments || segments.length === 0) {
      if (el) el.innerHTML = '<div class="empty-state">No data</div>';
      return;
    }

    const size = 180;
    const cx = size / 2;
    const cy = size / 2;
    const outerR = 70;
    const innerR = 45;
    const total = segments.reduce((sum, s) => sum + s.value, 0) || 1;
    const colors = [
      'var(--chart-primary)',
      'var(--chart-secondary)',
      'var(--chart-tertiary)',
      'var(--status-ok)',
      'var(--status-warn)',
    ];

    let paths = '';
    let angle = -Math.PI / 2;
    segments.forEach((seg, i) => {
      const sweep = (seg.value / total) * Math.PI * 2;
      const startX = cx + outerR * Math.cos(angle);
      const startY = cy + outerR * Math.sin(angle);
      const endAngle = angle + sweep;
      const endX = cx + outerR * Math.cos(endAngle);
      const endY = cy + outerR * Math.sin(endAngle);
      const innerStartX = cx + innerR * Math.cos(endAngle);
      const innerStartY = cy + innerR * Math.sin(endAngle);
      const innerEndX = cx + innerR * Math.cos(angle);
      const innerEndY = cy + innerR * Math.sin(angle);
      const largeArc = sweep > Math.PI ? 1 : 0;
      const color = colors[i % colors.length];

      paths += \`<path d="M\${startX},\${startY} A\${outerR},\${outerR} 0 \${largeArc},1 \${endX},\${endY} L\${innerStartX},\${innerStartY} A\${innerR},\${innerR} 0 \${largeArc},0 \${innerEndX},\${innerEndY} Z" fill="\${color}" opacity="0.85"><title>\${seg.label}: \${formatNum(seg.value)} (\${((seg.value / total) * 100).toFixed(1)}%)</title></path>\`;
      angle = endAngle;
    });

    // Center text
    paths += \`<text x="\${cx}" y="\${cy - 4}" text-anchor="middle" fill="var(--fg)" font-size="14" font-weight="700">\${formatNum(total)}</text>\`;
    paths += \`<text x="\${cx}" y="\${cy + 12}" text-anchor="middle" fill="var(--fg-muted)" font-size="10">total</text>\`;

    // Legend
    let legend = '';
    segments.forEach((seg, i) => {
      const lx = size + 10;
      const ly = 20 + i * 20;
      const color = colors[i % colors.length];
      legend += \`<rect x="\${lx}" y="\${ly - 8}" width="10" height="10" rx="2" fill="\${color}"/>\`;
      legend += \`<text x="\${lx + 16}" y="\${ly}" fill="var(--chart-axis)" font-size="11">\${seg.label}: \${formatNum(seg.value)}</text>\`;
    });

    const svgWidth = size + 160;
    el.innerHTML = \`<svg viewBox="0 0 \${svgWidth} \${size}" preserveAspectRatio="xMidYMid meet">\${paths}\${legend}</svg>\`;
  }

  return { renderBarChart, renderLineChart, renderDonutChart, formatNum };
})();
`;
}
