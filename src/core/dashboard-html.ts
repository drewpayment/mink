export function getDashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mink Dashboard</title>
<style>
:root {
  --bg: #ffffff; --fg: #1a1a2e; --surface: #f5f5f7; --border: #e0e0e4;
  --accent: #6c5ce7; --accent-fg: #ffffff; --muted: #6b7280;
  --success: #10b981; --danger: #ef4444; --warning: #f59e0b;
  --font-mono: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
  --font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  --radius: 6px;
}
[data-theme="dark"] {
  --bg: #0f0f1a; --fg: #e0e0e8; --surface: #1a1a2e; --border: #2a2a3e;
  --accent: #a29bfe; --accent-fg: #0f0f1a; --muted: #9ca3af;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #0f0f1a; --fg: #e0e0e8; --surface: #1a1a2e; --border: #2a2a3e;
    --accent: #a29bfe; --accent-fg: #0f0f1a; --muted: #9ca3af;
  }
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: var(--bg); color: var(--fg); font-family: var(--font-sans); font-size: 14px; line-height: 1.5; }
header { display: flex; align-items: center; gap: 12px; padding: 12px 20px; border-bottom: 1px solid var(--border); background: var(--surface); }
header h1 { font-size: 18px; font-weight: 700; font-family: var(--font-mono); }
#connection-indicator { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); margin-left: auto; }
#connection-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--success); }
#connection-dot.disconnected { background: var(--danger); }
#theme-toggle { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 4px 10px; cursor: pointer; color: var(--fg); font-size: 12px; }
nav { display: flex; gap: 2px; padding: 8px 20px; border-bottom: 1px solid var(--border); background: var(--surface); overflow-x: auto; flex-wrap: wrap; }
nav button { background: transparent; border: 1px solid transparent; border-radius: var(--radius); padding: 6px 12px; cursor: pointer; font-size: 12px; color: var(--muted); white-space: nowrap; font-family: var(--font-sans); }
nav button:hover { background: var(--bg); color: var(--fg); }
nav button.active { background: var(--accent); color: var(--accent-fg); border-color: var(--accent); }
main { padding: 20px; max-width: 1200px; margin: 0 auto; }
.panel { display: none; }
.panel.active { display: block; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px; margin-bottom: 12px; }
.card h3 { font-size: 14px; font-weight: 600; margin-bottom: 8px; }
.stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin-bottom: 16px; }
.stat-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 14px; text-align: center; }
.stat-card .value { font-size: 24px; font-weight: 700; font-family: var(--font-mono); color: var(--accent); }
.stat-card .label { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; margin-top: 4px; }
.badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 600; }
.badge.ok { background: #d1fae5; color: #065f46; }
.badge.offline { background: #fee2e2; color: #991b1b; }
[data-theme="dark"] .badge.ok { background: #064e3b; color: #6ee7b7; }
[data-theme="dark"] .badge.offline { background: #7f1d1d; color: #fca5a5; }
table { width: 100%; border-collapse: collapse; font-size: 13px; font-family: var(--font-mono); }
th { text-align: left; padding: 8px; border-bottom: 2px solid var(--border); font-size: 11px; text-transform: uppercase; color: var(--muted); letter-spacing: 0.5px; }
td { padding: 8px; border-bottom: 1px solid var(--border); }
tr:hover td { background: var(--surface); }
.search-box { width: 100%; padding: 8px 12px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg); color: var(--fg); font-size: 13px; margin-bottom: 12px; font-family: var(--font-mono); }
.search-box:focus { outline: 2px solid var(--accent); outline-offset: -1px; }
.btn { display: inline-block; padding: 4px 12px; border-radius: var(--radius); border: 1px solid var(--border); background: var(--surface); color: var(--fg); cursor: pointer; font-size: 12px; }
.btn:hover { background: var(--accent); color: var(--accent-fg); border-color: var(--accent); }
.btn.primary { background: var(--accent); color: var(--accent-fg); border-color: var(--accent); }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
details { margin-bottom: 8px; }
details summary { cursor: pointer; padding: 8px; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); font-size: 13px; }
details[open] summary { border-bottom-left-radius: 0; border-bottom-right-radius: 0; }
details .detail-body { padding: 12px; border: 1px solid var(--border); border-top: none; border-radius: 0 0 var(--radius) var(--radius); font-family: var(--font-mono); font-size: 12px; }
.section-block { margin-bottom: 16px; }
.section-block h4 { font-size: 13px; margin-bottom: 6px; color: var(--accent); }
.section-block ul { list-style: disc; padding-left: 20px; }
.section-block li { font-size: 13px; margin-bottom: 2px; }
.empty-state { text-align: center; padding: 40px; color: var(--muted); }
.file-status { display: inline-flex; gap: 4px; align-items: center; }
.file-status .dot { width: 6px; height: 6px; border-radius: 50%; }
.file-status .dot.ok { background: var(--success); }
.file-status .dot.missing { background: var(--warning); }
.file-status .dot.corrupt { background: var(--danger); }
svg.chart { width: 100%; height: 200px; }
.chart-container { margin: 12px 0; }
.virtual-scroll { max-height: 500px; overflow-y: auto; }
.tag { display: inline-block; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 1px 8px; font-size: 11px; margin: 1px 2px; }
.filter-row { display: flex; gap: 8px; margin-bottom: 12px; align-items: center; }
.filter-row select { padding: 6px 8px; border: 1px solid var(--border); border-radius: var(--radius); background: var(--bg); color: var(--fg); font-size: 13px; }
</style>
</head>
<body>
<header>
  <h1>mink</h1>
  <div id="connection-indicator">
    <span id="connection-dot"></span>
    <span id="connection-text">connecting...</span>
  </div>
  <button id="theme-toggle" onclick="toggleTheme()">theme</button>
</header>
<nav id="panel-nav">
  <button class="active" data-panel="overview">Overview</button>
  <button data-panel="timeline">Activity</button>
  <button data-panel="tokens">Tokens</button>
  <button data-panel="scheduler">Scheduler</button>
  <button data-panel="learning">Learning</button>
  <button data-panel="action-log">Action Log</button>
  <button data-panel="file-index">File Index</button>
  <button data-panel="bugs">Bugs</button>
  <button data-panel="insights">Insights</button>
  <button data-panel="design">Design</button>
</nav>
<main>
  <div id="panel-overview" class="panel active"></div>
  <div id="panel-timeline" class="panel"></div>
  <div id="panel-tokens" class="panel"></div>
  <div id="panel-scheduler" class="panel"></div>
  <div id="panel-learning" class="panel"></div>
  <div id="panel-action-log" class="panel"></div>
  <div id="panel-file-index" class="panel"></div>
  <div id="panel-bugs" class="panel"></div>
  <div id="panel-insights" class="panel"></div>
  <div id="panel-design" class="panel"></div>
</main>
<script type="module">
// ── State ──────────────────────────────────────────────────────────────────
const store = {};
const staleFlags = new Set();
let activePanel = 'overview';

// ── API ────────────────────────────────────────────────────────────────────
async function api(path) {
  try {
    const res = await fetch(path);
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

async function postApi(path) {
  try {
    const res = await fetch(path, { method: 'POST' });
    return await res.json();
  } catch { return { success: false, error: 'Network error' }; }
}

// ── SSE ────────────────────────────────────────────────────────────────────
const FILE_TO_PANEL = {
  'token-ledger': ['overview', 'tokens', 'timeline', 'insights'],
  'file-index': ['overview', 'file-index'],
  'learning-memory': ['learning'],
  'bug-memory': ['bugs'],
  'action-log': ['action-log', 'timeline'],
  'scheduler-manifest': ['scheduler'],
  'session': ['overview', 'timeline'],
  'project-meta': ['overview'],
};

function connectSSE() {
  const es = new EventSource('/api/events');
  es.onopen = () => { setConnected(true); refreshPanel(activePanel); };
  es.onmessage = (e) => {
    try {
      const { fileId } = JSON.parse(e.data);
      const panels = FILE_TO_PANEL[fileId] || [];
      for (const p of panels) {
        if (p === activePanel) refreshPanel(p);
        else staleFlags.add(p);
      }
    } catch {}
  };
  es.onerror = () => { setConnected(false); es.close(); setTimeout(connectSSE, 3000); };
}

function setConnected(v) {
  const dot = document.getElementById('connection-dot');
  const text = document.getElementById('connection-text');
  if (v) { dot.className = ''; text.textContent = 'connected'; }
  else { dot.className = 'disconnected'; text.textContent = 'reconnecting...'; }
}

// ── Navigation ─────────────────────────────────────────────────────────────
document.getElementById('panel-nav').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-panel]');
  if (!btn) return;
  const panel = btn.dataset.panel;
  document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.getElementById('panel-' + panel).classList.add('active');
  activePanel = panel;
  if (staleFlags.has(panel) || !store[panel]) { staleFlags.delete(panel); refreshPanel(panel); }
});

if (location.hash) {
  const h = location.hash.slice(1);
  const btn = document.querySelector('button[data-panel="' + h + '"]');
  if (btn) btn.click();
}

// ── Panel Refresh ──────────────────────────────────────────────────────────
const PANEL_ENDPOINTS = {
  overview: '/api/overview',
  timeline: '/api/token-ledger',
  tokens: '/api/token-ledger',
  scheduler: '/api/scheduler',
  learning: '/api/learning-memory',
  'action-log': '/api/action-log',
  'file-index': '/api/file-index',
  bugs: '/api/bugs',
  insights: '/api/token-ledger',
  design: null,
};

async function refreshPanel(panel) {
  const endpoint = PANEL_ENDPOINTS[panel];
  if (!endpoint && panel !== 'design') return;
  if (panel === 'design') { renderDesign(); return; }
  const data = await api(endpoint);
  store[panel] = data;
  const renderers = { overview: renderOverview, timeline: renderTimeline, tokens: renderTokens, scheduler: renderScheduler, learning: renderLearning, 'action-log': renderActionLog, 'file-index': renderFileIndex, bugs: renderBugs, insights: renderInsights };
  if (renderers[panel] && data) renderers[panel](data);
  else if (!data) document.getElementById('panel-' + panel).innerHTML = '<div class="empty-state">Data unavailable</div>';
}

// ── Theme ──────────────────────────────────────────────────────────────────
function initTheme() {
  const saved = localStorage.getItem('mink-theme');
  if (saved) document.documentElement.dataset.theme = saved;
}
window.toggleTheme = function() {
  const el = document.documentElement;
  const current = el.dataset.theme;
  let next;
  if (!current || current === 'light') next = 'dark';
  else next = 'light';
  el.dataset.theme = next;
  localStorage.setItem('mink-theme', next);
};
initTheme();

// ── Helpers ────────────────────────────────────────────────────────────────
function esc(s) { if (!s) return ''; const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function num(n) { return (n ?? 0).toLocaleString(); }
function truncPath(p, max=50) { if (!p || p.length <= max) return p; return '...' + p.slice(-(max-3)); }

// ── SVG Charts ─────────────────────────────────────────────────────────────
function createLineChart(points, opts = {}) {
  if (!points.length) return '<div class="empty-state">No data</div>';
  const w = opts.width || 600, h = opts.height || 180, pad = 40;
  const maxY = Math.max(...points.map(p => p.y)) || 1;
  const xStep = points.length > 1 ? (w - pad * 2) / (points.length - 1) : 0;
  const coords = points.map((p, i) => {
    const x = pad + i * xStep;
    const y = h - pad - ((p.y / maxY) * (h - pad * 2));
    return x + ',' + y;
  });
  const gridLines = Array.from({length: 4}, (_, i) => {
    const y = pad + ((h - pad * 2) / 4) * i;
    const val = Math.round(maxY - (maxY / 4) * i);
    return '<line x1="' + pad + '" y1="' + y + '" x2="' + (w - pad) + '" y2="' + y + '" stroke="var(--border)" stroke-dasharray="4"/><text x="' + (pad - 4) + '" y="' + (y + 4) + '" text-anchor="end" fill="var(--muted)" font-size="10">' + num(val) + '</text>';
  }).join('');
  return '<svg class="chart" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="xMidYMid meet">' + gridLines + '<polyline points="' + coords.join(' ') + '" fill="none" stroke="var(--accent)" stroke-width="2"/>' + coords.map((c, i) => '<circle cx="' + c.split(',')[0] + '" cy="' + c.split(',')[1] + '" r="3" fill="var(--accent)"><title>' + esc(points[i].label || '') + ': ' + num(points[i].y) + '</title></circle>').join('') + '</svg>';
}

function createBarChart(labels, values, opts = {}) {
  if (!values.length) return '<div class="empty-state">No data</div>';
  const w = opts.width || 600, h = opts.height || 180, pad = 40;
  const maxY = Math.max(...values) || 1;
  const barW = Math.max(8, Math.min(40, (w - pad * 2) / values.length - 4));
  const bars = values.map((v, i) => {
    const x = pad + (i * (w - pad * 2) / values.length) + 2;
    const barH = (v / maxY) * (h - pad * 2);
    const y = h - pad - barH;
    return '<rect x="' + x + '" y="' + y + '" width="' + barW + '" height="' + barH + '" fill="var(--accent)" rx="2"><title>' + esc(labels[i]) + ': ' + num(v) + '</title></rect>';
  }).join('');
  return '<svg class="chart" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="xMidYMid meet">' + bars + '</svg>';
}

// ── Panel Renderers ────────────────────────────────────────────────────────

function renderOverview(d) {
  const daemonBadge = d.daemon.running
    ? '<span class="badge ok">running (PID ' + d.daemon.pid + ')</span>'
    : '<span class="badge offline">offline</span>';
  const files = (d.stateFiles || []).map(f =>
    '<span class="file-status"><span class="dot ' + f.status + '"></span> ' + esc(f.name) + '</span>'
  ).join(' &nbsp; ');
  document.getElementById('panel-overview').innerHTML =
    '<div class="card"><h3>' + esc(d.project?.name || 'Mink Project') + '</h3>' +
    '<p style="color:var(--muted);margin-bottom:8px">' + esc(d.project?.description || d.project?.cwd || '') + '</p>' +
    '<p>Daemon: ' + daemonBadge + '</p></div>' +
    '<div class="stat-grid">' +
    '<div class="stat-card"><div class="value">' + num(d.summary.totalSessions) + '</div><div class="label">Sessions</div></div>' +
    '<div class="stat-card"><div class="value">' + num(d.summary.totalTokens) + '</div><div class="label">Total Tokens</div></div>' +
    '<div class="stat-card"><div class="value">' + num(d.summary.totalReads) + '</div><div class="label">Reads</div></div>' +
    '<div class="stat-card"><div class="value">' + num(d.summary.totalWrites) + '</div><div class="label">Writes</div></div>' +
    '<div class="stat-card"><div class="value">' + num(d.summary.estimatedSavings) + '</div><div class="label">Est. Savings</div></div>' +
    '</div>' +
    '<div class="card"><h3>State Files</h3><p style="margin-top:8px">' + files + '</p></div>';
}

function renderTimeline(d) {
  const el = document.getElementById('panel-timeline');
  if (!d.sessions || !d.sessions.length) { el.innerHTML = '<div class="empty-state">No sessions recorded</div>'; return; }
  const rows = d.sessions.slice().reverse().map(s => {
    const start = new Date(s.startTimestamp).toLocaleString();
    const reads = s.totals?.readCount ?? 0;
    const writes = s.totals?.writeCount ?? 0;
    const tokens = s.totals?.estimatedTokens ?? 0;
    return '<tr><td>' + esc(start) + '</td><td>' + reads + '</td><td>' + writes + '</td><td>' + num(tokens) + '</td><td>' + num(s.estimatedSavings) + '</td></tr>';
  }).join('');
  el.innerHTML = '<div class="card"><h3>Session History</h3><div class="virtual-scroll"><table><thead><tr><th>Started</th><th>Reads</th><th>Writes</th><th>Tokens</th><th>Savings</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';
}

function renderTokens(d) {
  const el = document.getElementById('panel-tokens');
  const lt = d.lifetime;
  const sessions = d.sessions || [];
  const perSession = sessions.map((s, i) => ({ label: 'S' + (i + 1), y: s.totals?.estimatedTokens ?? 0 }));
  const cumulative = []; let sum = 0;
  sessions.forEach((s, i) => { sum += s.totals?.estimatedTokens ?? 0; cumulative.push({ label: 'S' + (i + 1), y: sum }); });
  const readWrite = sessions.map(s => ({ reads: s.totals?.readCount ?? 0, writes: s.totals?.writeCount ?? 0 }));
  const rwLabels = sessions.map((_, i) => 'S' + (i + 1));
  el.innerHTML =
    '<div class="stat-grid">' +
    '<div class="stat-card"><div class="value">' + num(lt.totalTokens) + '</div><div class="label">Lifetime Tokens</div></div>' +
    '<div class="stat-card"><div class="value">' + num(lt.totalEstimatedSavings) + '</div><div class="label">Lifetime Savings</div></div>' +
    '<div class="stat-card"><div class="value">' + num(lt.totalReads) + '</div><div class="label">Total Reads</div></div>' +
    '<div class="stat-card"><div class="value">' + num(lt.totalWrites) + '</div><div class="label">Total Writes</div></div>' +
    '</div>' +
    '<div class="card"><h3>Tokens Per Session</h3><div class="chart-container">' + createLineChart(perSession) + '</div></div>' +
    '<div class="card"><h3>Cumulative Token Usage</h3><div class="chart-container">' + createLineChart(cumulative) + '</div></div>' +
    '<div class="card"><h3>Read vs Write (per session)</h3><div class="chart-container">' + createBarChart(rwLabels, readWrite.map(r => r.reads + r.writes)) + '</div></div>';
}

function renderScheduler(d) {
  const el = document.getElementById('panel-scheduler');
  const taskRows = (d.tasks || []).map(t => {
    const def = t.definition;
    const st = t.state;
    const status = st?.status ?? 'unknown';
    const statusClass = status === 'idle' ? 'ok' : status === 'dead-lettered' ? 'offline' : 'ok';
    const lastRun = st?.lastRunAt ? new Date(st.lastRunAt).toLocaleString() : 'never';
    return '<tr><td>' + esc(def.name) + '</td><td><code>' + esc(def.schedule) + '</code></td><td>' + (def.enabled ? 'Yes' : 'No') + '</td><td><span class="badge ' + statusClass + '">' + status + '</span></td><td>' + lastRun + '</td><td><button class="btn" onclick="runTask(\\''+def.id+'\\')">Run</button></td></tr>';
  }).join('');
  const dlRows = (d.deadLetterQueue || []).map(dl => {
    return '<tr><td>' + esc(dl.taskId) + '</td><td>' + new Date(dl.deadLetteredAt).toLocaleString() + '</td><td>' + dl.attemptCount + '</td><td>' + esc(dl.errorMessages[dl.errorMessages.length - 1] || '') + '</td><td><button class="btn" onclick="retryDL(\\''+dl.taskId+'\\')">Retry</button></td></tr>';
  }).join('');
  el.innerHTML =
    '<div class="card"><h3>Scheduled Tasks</h3><table><thead><tr><th>Name</th><th>Schedule</th><th>Enabled</th><th>Status</th><th>Last Run</th><th>Action</th></tr></thead><tbody>' + taskRows + '</tbody></table></div>' +
    (dlRows ? '<div class="card"><h3>Dead Letter Queue</h3><table><thead><tr><th>Task</th><th>Dead Lettered</th><th>Attempts</th><th>Last Error</th><th>Action</th></tr></thead><tbody>' + dlRows + '</tbody></table></div>' : '');
}

window.runTask = async function(id) {
  const r = await postApi('/api/tasks/' + id + '/run');
  if (r.success) refreshPanel('scheduler');
  else alert('Task failed: ' + (r.error || 'unknown'));
};

window.retryDL = async function(id) {
  const r = await postApi('/api/dead-letter/' + id + '/retry');
  if (r.success) refreshPanel('scheduler');
  else alert('Retry failed: ' + (r.error || 'unknown'));
};

function renderLearning(d) {
  const el = document.getElementById('panel-learning');
  if (!d) { el.innerHTML = '<div class="empty-state">No learning memory</div>'; return; }
  const sections = d.sections || {};
  let html = '<div class="card"><h3>Learning Memory' + (d.projectName ? ' — ' + esc(d.projectName) : '') + '</h3></div>';
  for (const [name, entries] of Object.entries(sections)) {
    const items = (entries || []).map(e => '<li>' + esc(e) + '</li>').join('');
    html += '<div class="section-block card"><h4>' + esc(name) + ' (' + (entries || []).length + ')</h4>' + (items ? '<ul>' + items + '</ul>' : '<p style="color:var(--muted)">No entries</p>') + '</div>';
  }
  el.innerHTML = html;
}

function renderActionLog(d) {
  const el = document.getElementById('panel-action-log');
  const sessions = d.sessions || [];
  if (!sessions.length) { el.innerHTML = '<div class="empty-state">No action log entries</div>'; return; }
  let html = '<input class="search-box" placeholder="Search action log..." oninput="filterActionLog(this.value)"/><div id="action-log-content" class="virtual-scroll">';
  for (const s of sessions.slice().reverse()) {
    html += '<div class="card action-log-session" data-content="' + esc(s.content.toLowerCase()) + '">';
    html += '<pre style="white-space:pre-wrap;font-size:12px;font-family:var(--font-mono);overflow-x:auto">' + esc(s.content) + '</pre></div>';
  }
  html += '</div>';
  el.innerHTML = html;
}

window.filterActionLog = function(q) {
  const query = q.toLowerCase();
  document.querySelectorAll('.action-log-session').forEach(el => {
    el.style.display = !query || el.dataset.content.includes(query) ? '' : 'none';
  });
};

function renderFileIndex(d) {
  const el = document.getElementById('panel-file-index');
  const entries = d.entries || [];
  const header = d.header || {};
  if (!entries.length) { el.innerHTML = '<div class="empty-state">No files indexed</div>'; return; }
  const dirs = [...new Set(entries.map(e => { const parts = e.filePath.split('/'); return parts.length > 1 ? parts.slice(0, -1).join('/') : '.'; }))].sort();
  const dirOptions = '<option value="">All directories</option>' + dirs.map(d => '<option value="' + esc(d) + '">' + esc(d) + '</option>').join('');
  let html = '<div class="card"><h3>File Index</h3><p style="color:var(--muted);margin-bottom:8px">' + num(header.totalFiles) + ' files | Last scan: ' + (header.lastScanTimestamp ? new Date(header.lastScanTimestamp).toLocaleString() : 'never') + ' | Hits: ' + num(header.lifetimeHits) + ' Misses: ' + num(header.lifetimeMisses) + '</p></div>';
  html += '<div class="filter-row"><input class="search-box" style="margin:0" placeholder="Search files..." oninput="filterFiles()"/><select id="dir-filter" onchange="filterFiles()">' + dirOptions + '</select></div>';
  html += '<div id="file-index-content" class="virtual-scroll"><table><thead><tr><th>File</th><th>Description</th><th>Tokens</th></tr></thead><tbody>';
  for (const e of entries) {
    html += '<tr class="file-row" data-path="' + esc(e.filePath.toLowerCase()) + '" data-desc="' + esc((e.description || '').toLowerCase()) + '" data-dir="' + esc(e.filePath.split('/').slice(0, -1).join('/') || '.') + '"><td>' + esc(truncPath(e.filePath)) + '</td><td style="color:var(--muted)">' + esc(e.description || '') + '</td><td>' + num(e.estimatedTokens) + '</td></tr>';
  }
  html += '</tbody></table></div>';
  el.innerHTML = html;
}

window.filterFiles = function() {
  const q = (document.querySelector('#panel-file-index .search-box')?.value || '').toLowerCase();
  const dir = document.getElementById('dir-filter')?.value || '';
  document.querySelectorAll('.file-row').forEach(row => {
    const matchQ = !q || row.dataset.path.includes(q) || row.dataset.desc.includes(q);
    const matchD = !dir || row.dataset.dir === dir;
    row.style.display = matchQ && matchD ? '' : 'none';
  });
};

function renderBugs(d) {
  const el = document.getElementById('panel-bugs');
  const entries = d.entries || [];
  if (!entries.length) { el.innerHTML = '<div class="empty-state">No bugs recorded</div>'; return; }
  let html = '<input class="search-box" placeholder="Search bugs..." oninput="filterBugs(this.value)"/><div id="bugs-content">';
  for (const b of entries) {
    const searchable = [b.errorMessage, b.rootCause, b.fixDescription, ...(b.tags || [])].join(' ').toLowerCase();
    const tags = (b.tags || []).map(t => '<span class="tag">' + esc(t) + '</span>').join('');
    html += '<details class="bug-entry" data-search="' + esc(searchable) + '">' +
      '<summary><strong>' + esc(b.id) + '</strong> — ' + esc(b.errorMessage) + ' <span style="color:var(--muted);font-size:11px">(x' + b.occurrenceCount + ')</span></summary>' +
      '<div class="detail-body">' +
      '<p><strong>File:</strong> ' + esc(b.filePath) + (b.lineNumber ? ':' + b.lineNumber : '') + '</p>' +
      '<p><strong>Root cause:</strong> ' + esc(b.rootCause) + '</p>' +
      '<p><strong>Fix:</strong> ' + esc(b.fixDescription) + '</p>' +
      '<p><strong>Tags:</strong> ' + (tags || 'none') + '</p>' +
      '<p style="color:var(--muted);font-size:11px">Created: ' + new Date(b.createdAt).toLocaleString() + ' | Last seen: ' + new Date(b.lastSeenAt).toLocaleString() + '</p>' +
      '</div></details>';
  }
  html += '</div>';
  el.innerHTML = html;
}

window.filterBugs = function(q) {
  const query = q.toLowerCase();
  document.querySelectorAll('.bug-entry').forEach(el => {
    el.style.display = !query || el.dataset.search.includes(query) ? '' : 'none';
  });
};

function renderInsights(d) {
  const el = document.getElementById('panel-insights');
  const flags = d.wasteFlags || [];
  if (!flags.length) { el.innerHTML = '<div class="empty-state">No waste patterns detected. Run waste detection to analyze.</div>'; return; }
  let html = '<div class="card"><h3>AI Insights &amp; Waste Detection</h3></div>';
  for (const f of flags) {
    html += '<div class="card"><h3>' + esc(f.pattern) + '</h3><p>' + esc(f.description) + '</p><p style="color:var(--danger);margin-top:4px">~' + num(f.estimatedTokensWasted) + ' tokens wasted</p><p style="color:var(--accent);margin-top:4px">Suggestion: ' + esc(f.suggestion) + '</p></div>';
  }
  el.innerHTML = html;
}

function renderDesign() {
  document.getElementById('panel-design').innerHTML = '<div class="empty-state">Design evaluation captures will appear here after running <code>mink designqc</code>.</div>';
}

// ── Init ───────────────────────────────────────────────────────────────────
refreshPanel('overview');
connectSSE();
</script>
</body>
</html>`;
}
