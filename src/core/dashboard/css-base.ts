/**
 * Base CSS for the Mink dashboard: reset, layout grid, typography,
 * sidebar navigation, header bar, scrollbar, panel cards, connection indicator.
 */
export function cssBase(): string {
  return `
/* ── Reset ─────────────────────────────────────────────────── */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html { font-size: 14px; line-height: 1.5; }
body {
  font-family: "SF Mono", "Fira Code", "Cascadia Code", "Consolas", monospace;
  background: var(--bg);
  color: var(--fg);
  display: grid;
  grid-template-columns: 220px 1fr;
  grid-template-rows: 48px 1fr;
  grid-template-areas:
    "sidebar header"
    "sidebar main";
  height: 100vh;
  overflow: hidden;
  transition: background 0.2s, color 0.2s;
}

/* ── Header ────────────────────────────────────────────────── */
.header {
  grid-area: header;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}
.header h1 {
  font-size: 1rem;
  font-weight: 600;
  letter-spacing: 0.5px;
}
.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

/* ── Connection Indicator ──────────────────────────────────── */
.connection-indicator {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.75rem;
  color: var(--fg-muted);
}
.connection-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--status-error);
  transition: background 0.3s;
}
.connection-dot.connected { background: var(--status-ok); }

/* ── Theme Toggle ──────────────────────────────────────────── */
.theme-toggle {
  background: none;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 4px 10px;
  cursor: pointer;
  color: var(--fg);
  font-family: inherit;
  font-size: 0.75rem;
  transition: border-color 0.2s;
}
.theme-toggle:hover { border-color: var(--accent); }

/* ── Sidebar ───────────────────────────────────────────────── */
.sidebar {
  grid-area: sidebar;
  background: var(--surface);
  border-right: 1px solid var(--border);
  padding: 12px 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}
.sidebar-brand {
  padding: 8px 16px 16px;
  font-size: 1.1rem;
  font-weight: 700;
  letter-spacing: 1px;
  color: var(--accent);
}
.sidebar a {
  display: block;
  padding: 8px 16px;
  color: var(--fg-muted);
  text-decoration: none;
  font-size: 0.85rem;
  border-left: 3px solid transparent;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}
.sidebar a:hover {
  background: var(--hover);
  color: var(--fg);
}
.sidebar a.active {
  color: var(--accent);
  border-left-color: var(--accent);
  background: var(--hover);
}

/* ── Main Content ──────────────────────────────────────────── */
.main {
  grid-area: main;
  padding: 20px;
  overflow-y: auto;
}

/* ── Panel Cards ───────────────────────────────────────────── */
.panel {
  display: none;
}
.panel.active {
  display: block;
}
.panel-title {
  font-size: 1.1rem;
  font-weight: 600;
  margin-bottom: 16px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border);
}
.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 12px;
}

/* ── Stat Cards Grid ───────────────────────────────────────── */
.stat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}
.stat-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 14px;
  text-align: center;
}
.stat-card .stat-value {
  font-size: 1.6rem;
  font-weight: 700;
  color: var(--accent);
}
.stat-card .stat-label {
  font-size: 0.75rem;
  color: var(--fg-muted);
  margin-top: 2px;
}

/* ── Tables ────────────────────────────────────────────────── */
.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85rem;
}
.data-table th,
.data-table td {
  padding: 8px 12px;
  text-align: left;
  border-bottom: 1px solid var(--border);
}
.data-table th {
  font-weight: 600;
  color: var(--fg-muted);
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.data-table tr:hover td { background: var(--hover); }

/* ── Search Input ──────────────────────────────────────────── */
.search-bar {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}
.search-input {
  flex: 1;
  padding: 6px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--fg);
  font-family: inherit;
  font-size: 0.85rem;
  outline: none;
  transition: border-color 0.2s;
}
.search-input:focus { border-color: var(--accent); }
.search-input::placeholder { color: var(--fg-muted); }

/* ── Filter Select ─────────────────────────────────────────── */
.filter-select {
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg);
  color: var(--fg);
  font-family: inherit;
  font-size: 0.85rem;
  cursor: pointer;
}

/* ── Buttons ───────────────────────────────────────────────── */
.btn {
  padding: 5px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  color: var(--fg);
  font-family: inherit;
  font-size: 0.8rem;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.btn:hover { border-color: var(--accent); background: var(--hover); }
.btn-primary {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}
.btn-primary:hover { opacity: 0.9; }

/* ── Status Badges ─────────────────────────────────────────── */
.badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}
.badge-ok { background: var(--status-ok-bg); color: var(--status-ok); }
.badge-warn { background: var(--status-warn-bg); color: var(--status-warn); }
.badge-error { background: var(--status-error-bg); color: var(--status-error); }
.badge-idle { background: var(--hover); color: var(--fg-muted); }

/* ── Virtual Scroll Container ──────────────────────────────── */
.virtual-viewport {
  position: relative;
  overflow-y: auto;
  will-change: transform;
}
.virtual-spacer {
  width: 100%;
}
.virtual-content {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
}

/* ── Empty State ───────────────────────────────────────────── */
.empty-state {
  text-align: center;
  padding: 40px 20px;
  color: var(--fg-muted);
  font-size: 0.9rem;
}

/* ── Details / Expandable ──────────────────────────────────── */
details { margin-bottom: 8px; }
details summary {
  cursor: pointer;
  padding: 8px 12px;
  font-weight: 600;
  font-size: 0.9rem;
  border-radius: 6px;
  background: var(--hover);
  transition: background 0.15s;
}
details summary:hover { background: var(--border); }
details[open] summary { margin-bottom: 8px; }
details .detail-content {
  padding: 4px 12px 12px;
}
details .detail-content ul {
  list-style: disc;
  padding-left: 20px;
}
details .detail-content li {
  margin-bottom: 4px;
  font-size: 0.85rem;
}

/* ── Scrollbar ─────────────────────────────────────────────── */
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb {
  background: var(--border);
  border-radius: 3px;
}
::-webkit-scrollbar-thumb:hover { background: var(--fg-muted); }
`;
}
