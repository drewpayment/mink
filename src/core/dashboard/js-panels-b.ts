/**
 * Panel renderer functions (panels 6-10): Action Log, File Index, Bugs, Insights, Design.
 * Each function maps store data to DOM updates.
 */
export function jsPanelsB(): string {
  return `
// ── Panel Renderers (6-10) ──────────────────────────────────

function renderActionLogRow(entry, index) {
  const time = entry.time || '—';
  const action = entry.action || '—';
  const files = entry.files || '—';
  const outcome = entry.outcome || '';
  const tokens = entry.tokens || '';
  return \`<div style="display:grid; grid-template-columns:60px 80px 1fr 80px 70px; padding:6px 12px; border-bottom:1px solid var(--border); font-size:0.8rem; align-items:center;">
    <span>\${time}</span>
    <span>\${escapeHtml(action)}</span>
    <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="\${escapeHtml(files)}">\${escapeHtml(files)}</span>
    <span>\${escapeHtml(outcome)}</span>
    <span style="text-align:right;">\${tokens}</span>
  </div>\`;
}

function initActionLogScroller() {
  return createVirtualScroller(
    'action-log-viewport',
    'action-log-spacer',
    'action-log-content',
    32,
    renderActionLogRow
  );
}

function renderActionLogPanel(entries, scroller) {
  const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  setText('action-log-total', String(entries.length));

  // Count unique sessions by grouping consecutive entries
  let sessionCount = 0;
  let inSession = false;
  entries.forEach(e => {
    if (e.action === 'session-start') { sessionCount++; inSession = true; }
    else if (!inSession && e.action) { sessionCount++; inSession = true; }
  });
  setText('action-log-session-count', String(sessionCount || '—'));

  scroller.setData(entries);
}

function renderFileIndexRow(entry, index) {
  const path = entry.filePath || entry.path || '—';
  const desc = entry.description || '';
  const tokens = entry.estimatedTokens || 0;
  const modified = entry.lastModified ? formatDate(entry.lastModified) : '—';
  return \`<div class="card" style="padding:8px 14px; margin-bottom:4px;">
    <div style="display:flex; justify-content:space-between; align-items:baseline;">
      <strong style="font-size:0.85rem; word-break:break-all;">\${escapeHtml(path)}</strong>
      <span style="font-size:0.75rem; color:var(--accent); white-space:nowrap; margin-left:12px;">~\${Charts.formatNum(tokens)} tokens</span>
    </div>
    <div style="font-size:0.75rem; color:var(--fg-muted); margin-top:2px;">
      \${desc ? escapeHtml(desc) : '<em>No description</em>'}
    </div>
    <div style="font-size:0.7rem; color:var(--fg-muted); margin-top:2px;">Modified: \${modified}</div>
  </div>\`;
}

function initFileIndexScroller() {
  return createVirtualScroller(
    'file-index-viewport',
    'file-index-spacer',
    'file-index-content',
    80,
    renderFileIndexRow
  );
}

function renderFileIndexPanel(data, scroller) {
  const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

  if (!data || !data.header) {
    setText('file-index-total', '—');
    setText('file-index-last-scan', '—');
    setText('file-index-hit-ratio', '—');
    return;
  }

  setText('file-index-total', String(data.header.totalFiles || 0));
  setText('file-index-last-scan', data.header.lastScanTimestamp ? formatDate(data.header.lastScanTimestamp) : '—');

  const hits = data.header.lifetimeHits || 0;
  const misses = data.header.lifetimeMisses || 0;
  const total = hits + misses;
  setText('file-index-hit-ratio', total > 0 ? ((hits / total) * 100).toFixed(1) + '%' : '—');

  // Normalize entries to array (API may return array or object keyed by path)
  const entries = Array.isArray(data.entries)
    ? data.entries
    : data.entries
      ? Object.entries(data.entries).map(([path, entry]) => ({ ...entry, filePath: path }))
      : [];

  setText('file-index-showing', String(entries.length));
  setText('file-index-of', String(entries.length));

  scroller.setData(entries);
  populateDirectoryFilter('file-index-dir-filter', entries);
}

function renderBugs(bugs) {
  const list = document.getElementById('bug-list');
  const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

  setText('bug-total', String((bugs || []).length));

  const totalOccurrences = (bugs || []).reduce((sum, b) => sum + (b.occurrenceCount || 0), 0);
  setText('bug-total-occurrences', String(totalOccurrences));
  setText('bug-showing', String((bugs || []).length));
  setText('bug-of', String((bugs || []).length));

  // Populate tag filter
  const tagSelect = document.getElementById('bug-tag-filter');
  if (tagSelect && bugs) {
    const tags = new Set();
    bugs.forEach(b => (b.tags || []).forEach(t => tags.add(t)));
    const sorted = [...tags].sort();
    const firstOpt = tagSelect.options[0];
    tagSelect.innerHTML = '';
    tagSelect.appendChild(firstOpt);
    sorted.forEach(tag => {
      const opt = document.createElement('option');
      opt.value = tag;
      opt.textContent = tag;
      tagSelect.appendChild(opt);
    });
  }

  if (!list) return;
  if (!bugs || bugs.length === 0) {
    list.innerHTML = '<div class="empty-state">No bugs recorded</div>';
    return;
  }

  list.innerHTML = bugs.map(b => \`
    <details class="card" style="padding:0;">
      <summary style="padding:10px 14px; border-radius:8px;">
        <span style="font-size:0.85rem;">\${escapeHtml(b.errorMessage || '—')}</span>
        <span class="badge badge-warn" style="margin-left:8px;">\${b.occurrenceCount || 1}x</span>
        \${(b.tags || []).map(t => '<span class="badge badge-idle" style="margin-left:4px;">' + escapeHtml(t) + '</span>').join('')}
      </summary>
      <div class="detail-content" style="padding:8px 14px 14px;">
        <div style="margin-bottom:6px;"><strong>File:</strong> <code>\${escapeHtml(b.filePath || '—')}</code>\${b.lineNumber ? ':' + b.lineNumber : ''}</div>
        <div style="margin-bottom:6px;"><strong>Root Cause:</strong> \${escapeHtml(b.rootCause || '—')}</div>
        <div style="margin-bottom:6px;"><strong>Fix:</strong> \${escapeHtml(b.fixDescription || '—')}</div>
        <div style="font-size:0.75rem; color:var(--fg-muted);">
          First seen: \${formatDateTime(b.createdAt)} · Last seen: \${formatDateTime(b.lastSeenAt)}
          \${b.relatedBugIds && b.relatedBugIds.length > 0 ? ' · Related: ' + b.relatedBugIds.join(', ') : ''}
        </div>
      </div>
    </details>
  \`).join('');
}

function renderInsights(flags) {
  const list = document.getElementById('insights-list');
  const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

  setText('insights-count', String((flags || []).length));
  const totalWasted = (flags || []).reduce((sum, f) => sum + (f.estimatedTokensWasted || 0), 0);
  setText('insights-wasted', Charts.formatNum(totalWasted));

  if (!list) return;
  if (!flags || flags.length === 0) {
    list.innerHTML = '<div class="empty-state">No insights available. Run the waste detection task to generate insights.</div>';
    return;
  }

  list.innerHTML = flags.map(f => {
    const patternLabel = (f.pattern || '').replace(/-/g, ' ');
    return \`<div class="card">
      <div style="display:flex; justify-content:space-between; align-items:baseline;">
        <strong style="text-transform:capitalize;">\${escapeHtml(patternLabel)}</strong>
        <span class="badge badge-warn">~\${Charts.formatNum(f.estimatedTokensWasted || 0)} tokens</span>
      </div>
      <div style="font-size:0.85rem; margin-top:6px;">\${escapeHtml(f.description || '')}</div>
      <div style="font-size:0.8rem; color:var(--accent); margin-top:6px;">
        💡 \${escapeHtml(f.suggestion || '')}
      </div>
      <div style="font-size:0.7rem; color:var(--fg-muted); margin-top:4px;">
        Detected: \${formatDateTime(f.detectedAt)}
      </div>
    </div>\`;
  }).join('');
}

function renderDesign(images) {
  const gallery = document.getElementById('design-gallery');
  const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };

  setText('design-count', String((images || []).length));

  if (!gallery) return;
  if (!images || images.length === 0) {
    gallery.innerHTML = '<div class="empty-state" style="grid-column:1/-1;">No design screenshots available. Run <code>mink designqc</code> to capture screenshots.</div>';
    return;
  }

  gallery.innerHTML = images.map(img => \`
    <div class="card" style="padding:8px; cursor:pointer;" data-lightbox-src="\${escapeHtml(img.url || '')}">
      <img src="\${escapeHtml(img.url || '')}" alt="Screenshot"
           style="width:100%; border-radius:4px; display:block;" loading="lazy" />
      <div style="font-size:0.75rem; color:var(--fg-muted); margin-top:6px;">
        \${img.viewport || '—'} · \${escapeHtml(img.route || '—')}
      </div>
      <div style="font-size:0.7rem; color:var(--fg-muted);">\${formatDateTime(img.timestamp)}</div>
    </div>
  \`).join('');
}
`;
}
