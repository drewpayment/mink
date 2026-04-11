/**
 * CSS custom properties for light and dark themes.
 * Includes system preference detection via prefers-color-scheme.
 */
export function cssThemes(): string {
  return `
/* ── Light Theme (default) ─────────────────────────────────── */
:root {
  --bg: #f8f9fa;
  --fg: #1a1a2e;
  --fg-muted: #6c757d;
  --surface: #ffffff;
  --border: #dee2e6;
  --hover: #f1f3f5;
  --accent: #6366f1;
  --accent-light: #818cf8;

  --status-ok: #16a34a;
  --status-ok-bg: #dcfce7;
  --status-warn: #ca8a04;
  --status-warn-bg: #fef9c3;
  --status-error: #dc2626;
  --status-error-bg: #fee2e2;

  --chart-primary: #6366f1;
  --chart-secondary: #06b6d4;
  --chart-tertiary: #f59e0b;
  --chart-grid: #e5e7eb;
  --chart-axis: #9ca3af;
}

/* ── Dark Theme ────────────────────────────────────────────── */
[data-theme="dark"] {
  --bg: #0f172a;
  --fg: #e2e8f0;
  --fg-muted: #94a3b8;
  --surface: #1e293b;
  --border: #334155;
  --hover: #283548;
  --accent: #818cf8;
  --accent-light: #a5b4fc;

  --status-ok: #4ade80;
  --status-ok-bg: #14532d;
  --status-warn: #fbbf24;
  --status-warn-bg: #713f12;
  --status-error: #f87171;
  --status-error-bg: #7f1d1d;

  --chart-primary: #818cf8;
  --chart-secondary: #22d3ee;
  --chart-tertiary: #fbbf24;
  --chart-grid: #334155;
  --chart-axis: #64748b;
}

/* ── System Preference Detection ───────────────────────────── */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #0f172a;
    --fg: #e2e8f0;
    --fg-muted: #94a3b8;
    --surface: #1e293b;
    --border: #334155;
    --hover: #283548;
    --accent: #818cf8;
    --accent-light: #a5b4fc;

    --status-ok: #4ade80;
    --status-ok-bg: #14532d;
    --status-warn: #fbbf24;
    --status-warn-bg: #713f12;
    --status-error: #f87171;
    --status-error-bg: #7f1d1d;

    --chart-primary: #818cf8;
    --chart-secondary: #22d3ee;
    --chart-tertiary: #fbbf24;
    --chart-grid: #334155;
    --chart-axis: #64748b;
  }
}

/* ── Chart Base Styles ─────────────────────────────────────── */
.chart-container {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 12px;
}
.chart-container svg {
  width: 100%;
  height: auto;
}
.chart-title {
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--fg-muted);
  margin-bottom: 8px;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}
.chart-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}
`;
}
