/**
 * Panel renderer functions (panels 1-5): Overview, Activity, Tokens, Scheduler, Learning.
 * Each function maps store data to DOM updates.
 */
export function jsPanelsA(): string {
  return `
// ── Panel Renderers (1-5) ───────────────────────────────────

function renderOverview(data) {
  if (!data) return;
  const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  const setBadge = (id, text, cls) => {
    const el = document.getElementById(id);
    if (el) { el.textContent = text; el.className = 'badge ' + cls; }
  };

  setText('project-name', data.projectName || '—');

  if (data.daemonRunning) {
    setBadge('daemon-status', 'running', 'badge-ok');
    const uptime = data.daemonUptime ? formatUptime(data.daemonUptime) : '';
    setText('daemon-detail', uptime ? 'Uptime: ' + uptime : 'Running');
  } else {
    setBadge('daemon-status', 'offline', 'badge-error');
    setText('daemon-detail', 'Start with: mink daemon start');
  }
}

function renderOverviewStats(ledger, fileIndex) {
  const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  if (ledger && ledger.lifetime) {
    const lt = ledger.lifetime;
    setText('stat-sessions', Charts.formatNum(lt.totalSessions || 0));
    setText('stat-tokens', Charts.formatNum(lt.totalTokens || 0));
    setText('stat-savings', Charts.formatNum(lt.totalEstimatedSavings || 0));
    setText('stat-reads', Charts.formatNum(lt.totalReads || 0));
    setText('stat-writes', Charts.formatNum(lt.totalWrites || 0));
  }
  if (fileIndex && fileIndex.header) {
    setText('stat-files', Charts.formatNum(fileIndex.header.totalFiles || 0));
  }
}

function renderActivity(ledger) {
  const list = document.getElementById('activity-list');
  if (!list) return;
  const sessions = (ledger && ledger.sessions) || [];

  const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  setText('activity-total-sessions', String(sessions.length));

  if (sessions.length === 0) {
    list.innerHTML = '<div class="empty-state">No sessions recorded yet</div>';
    return;
  }

  setText('activity-latest-date', formatDate(sessions[sessions.length - 1].startTimestamp));

  // Show most recent first
  const sorted = [...sessions].reverse();
  list.innerHTML = sorted.map(s => {
    const start = formatDateTime(s.startTimestamp);
    const end = s.endTimestamp ? formatDateTime(s.endTimestamp) : 'ongoing';
    const tokens = Charts.formatNum(s.totals?.estimatedTokens || 0);
    const reads = s.totals?.readCount || 0;
    const writes = s.totals?.writeCount || 0;
    const savings = Charts.formatNum(s.estimatedSavings || 0);
    return \`<div class="card" style="padding:10px 14px;">
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <div>
          <strong style="font-size:0.85rem;">\${start}</strong>
          <span style="color:var(--fg-muted); font-size:0.8rem;"> → \${end}</span>
        </div>
        <span style="font-size:0.75rem; color:var(--accent);">\${tokens} tokens</span>
      </div>
      <div style="font-size:0.75rem; color:var(--fg-muted); margin-top:4px;">
        \${reads} reads · \${writes} writes · \${savings} saved
      </div>
    </div>\`;
  }).join('');
}

function renderTokens(ledger) {
  if (!ledger || !ledger.lifetime) return;
  const lt = ledger.lifetime;
  const sessions = ledger.sessions || [];
  const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

  setText('token-total', Charts.formatNum(lt.totalTokens || 0));
  setText('token-savings', Charts.formatNum(lt.totalEstimatedSavings || 0));
  setText('token-session-count', String(lt.totalSessions || 0));

  const readRatio = lt.totalReads || 0;
  const writeRatio = lt.totalWrites || 0;
  const total = readRatio + writeRatio;
  setText('token-read-write', total > 0 ? ((readRatio / total) * 100).toFixed(0) + '% / ' + ((writeRatio / total) * 100).toFixed(0) + '%' : '—');

  // Bar chart: tokens per session
  const barData = sessions.map((s, i) => ({
    label: 'S' + (i + 1),
    value: s.totals?.estimatedTokens || 0,
  }));
  Charts.renderBarChart('chart-usage', barData);

  // Donut chart: read vs write
  Charts.renderDonutChart('chart-readwrite', [
    { label: 'Reads', value: lt.totalReads || 0 },
    { label: 'Writes', value: lt.totalWrites || 0 },
  ]);

  // Line chart: cumulative tokens and savings
  let cumTokens = 0;
  let cumSavings = 0;
  const tokenLine = sessions.map((s, i) => {
    cumTokens += s.totals?.estimatedTokens || 0;
    return { label: 'S' + (i + 1), value: cumTokens };
  });
  const savingsLine = sessions.map((s, i) => {
    cumSavings += s.estimatedSavings || 0;
    return { label: 'S' + (i + 1), value: cumSavings };
  });
  Charts.renderLineChart('chart-savings', [
    { label: 'Cumulative Tokens', data: tokenLine },
    { label: 'Cumulative Savings', data: savingsLine },
  ]);
}

function renderScheduler(tasks, definitions, deadLetters, health) {
  const tbody = document.getElementById('task-table-body');
  const dlList = document.getElementById('dead-letter-list');
  const dlCount = document.getElementById('dead-letter-count');
  const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  const setBadge = (id, text, cls) => {
    const el = document.getElementById(id);
    if (el) { el.textContent = text; el.className = 'badge ' + cls; }
  };

  // Health badge
  if (health) {
    setBadge('scheduler-daemon-badge', 'running', 'badge-ok');
    setText('scheduler-uptime', 'Uptime: ' + formatUptime(health.uptimeMs));
  } else {
    setBadge('scheduler-daemon-badge', 'offline', 'badge-error');
    setText('scheduler-uptime', 'Daemon not running');
  }

  // Task table
  if (tbody) {
    const defs = definitions || [];
    const records = tasks || [];
    if (defs.length === 0 && records.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-state">No tasks configured</td></tr>';
    } else {
      tbody.innerHTML = defs.map(def => {
        const record = records.find(r => r.taskId === def.id);
        const status = record ? record.status : 'idle';
        const badgeCls = status === 'running' ? 'badge-ok' : status === 'dead-lettered' ? 'badge-error' : status === 'retrying' ? 'badge-warn' : 'badge-idle';
        const lastRun = record && record.lastRunAt ? formatDateTime(record.lastRunAt) : '—';
        const nextRun = record && record.nextRunAt ? formatDateTime(record.nextRunAt) : '—';
        const failures = record ? record.consecutiveFailures : 0;
        return \`<tr>
          <td><strong>\${def.name}</strong><br><span style="font-size:0.75rem;color:var(--fg-muted);">\${def.description || ''}</span></td>
          <td style="font-size:0.8rem;">\${def.schedule}</td>
          <td><span class="badge \${badgeCls}">\${status}</span></td>
          <td style="font-size:0.8rem;">\${lastRun}</td>
          <td style="font-size:0.8rem;">\${nextRun}</td>
          <td>\${failures}</td>
          <td><button class="btn" data-action="run-task" data-task-id="\${def.id}">Run</button></td>
        </tr>\`;
      }).join('');
    }
  }

  // Dead letter queue
  if (dlCount) dlCount.textContent = String((deadLetters || []).length);
  if (dlList) {
    if (!deadLetters || deadLetters.length === 0) {
      dlList.innerHTML = '<div class="empty-state">No dead-lettered tasks</div>';
    } else {
      dlList.innerHTML = deadLetters.map(dl => \`
        <div class="card" style="padding:10px 14px;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <div>
              <strong>\${dl.taskId}</strong>
              <span class="badge badge-error" style="margin-left:8px;">\${dl.attemptCount} attempts</span>
            </div>
            <button class="btn" data-action="retry-dead-letter" data-task-id="\${dl.taskId}">Retry</button>
          </div>
          <div style="font-size:0.75rem; color:var(--fg-muted); margin-top:4px;">
            Dead-lettered: \${formatDateTime(dl.deadLetteredAt)}
          </div>
          <div style="font-size:0.75rem; color:var(--status-error); margin-top:2px;">
            \${dl.errorMessages && dl.errorMessages.length > 0 ? dl.errorMessages[dl.errorMessages.length - 1] : 'No error message'}
          </div>
        </div>
      \`).join('');
    }
  }
}

function renderLearning(data) {
  if (!data) return;
  const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  setText('learning-project-name', data.projectName || '—');

  const sectionMap = {
    'User Preferences': 'learning-prefs',
    'Key Learnings': 'learning-learnings',
    'Do-Not-Repeat': 'learning-donotrepeat',
    'Decision Log': 'learning-decisions',
  };

  const sections = data.sections || {};
  for (const [name, elId] of Object.entries(sectionMap)) {
    const items = sections[name] || [];
    const list = document.getElementById(elId);
    const count = document.getElementById(elId + '-count');
    if (count) count.textContent = '(' + items.length + ')';
    if (list) {
      if (items.length === 0) {
        list.innerHTML = '<li style="list-style:none;" class="empty-state">No entries yet</li>';
      } else {
        list.innerHTML = items.map(item => '<li>' + escapeHtml(item) + '</li>').join('');
      }
    }
  }
}

// ── Formatting Helpers ──────────────────────────────────────
function formatUptime(ms) {
  if (!ms || ms <= 0) return '—';
  const sec = Math.floor(ms / 1000);
  const min = Math.floor(sec / 60);
  const hr = Math.floor(min / 60);
  if (hr > 0) return hr + 'h ' + (min % 60) + 'm';
  if (min > 0) return min + 'm ' + (sec % 60) + 's';
  return sec + 's';
}

function formatDate(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleDateString(); } catch { return iso; }
}

function formatDateTime(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
`;
}
