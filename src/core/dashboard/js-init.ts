/**
 * DOMContentLoaded initialization: wires store subscriptions, SSE,
 * panel switching, search handlers, and action buttons.
 */
export function jsInit(): string {
  return `
// ── Init ────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Theme
  Store.initTheme();
  document.getElementById('theme-toggle')?.addEventListener('click', () => Store.toggleTheme());

  // ── Sidebar Navigation ──────────────────────────────────
  const navLinks = document.querySelectorAll('.sidebar a[data-panel]');
  const panels = document.querySelectorAll('.panel');

  function showPanel(panelId) {
    panels.forEach(p => p.classList.remove('active'));
    navLinks.forEach(a => a.classList.remove('active'));
    const target = document.getElementById('panel-' + panelId);
    if (target) target.classList.add('active');
    const link = document.querySelector('.sidebar a[data-panel="' + panelId + '"]');
    if (link) link.classList.add('active');
  }

  navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const panelId = link.getAttribute('data-panel');
      showPanel(panelId);
      window.location.hash = panelId;
    });
  });

  // Restore panel from hash
  const hash = window.location.hash.replace('#', '');
  if (hash) showPanel(hash);

  // ── Virtual Scrollers ───────────────────────────────────
  const actionLogScroller = initActionLogScroller();
  const fileIndexScroller = initFileIndexScroller();

  // ── Store Subscriptions ─────────────────────────────────
  Store.subscribe('overview', renderOverview);

  Store.subscribe('ledger', (ledger) => {
    renderOverviewStats(ledger, Store.get('fileIndex'));
    renderActivity(ledger);
    renderTokens(ledger);
  });

  Store.subscribe('fileIndex', (data) => {
    renderOverviewStats(Store.get('ledger'), data);
    renderFileIndexPanel(data, fileIndexScroller);
  });

  Store.subscribe('tasks', (tasks) => {
    renderScheduler(tasks, Store.get('taskDefinitions'), Store.get('deadLetters'), Store.get('health'));
  });

  Store.subscribe('taskDefinitions', (defs) => {
    renderScheduler(Store.get('tasks'), defs, Store.get('deadLetters'), Store.get('health'));
  });

  Store.subscribe('deadLetters', (dl) => {
    renderScheduler(Store.get('tasks'), Store.get('taskDefinitions'), dl, Store.get('health'));
  });

  Store.subscribe('health', (health) => {
    renderScheduler(Store.get('tasks'), Store.get('taskDefinitions'), Store.get('deadLetters'), health);
  });

  Store.subscribe('learningMemory', renderLearning);

  Store.subscribe('actionLog', (entries) => {
    renderActionLogPanel(entries, actionLogScroller);
  });

  Store.subscribe('bugs', renderBugs);
  Store.subscribe('wasteFlags', renderInsights);
  Store.subscribe('designImages', renderDesign);

  // ── Search Handlers ─────────────────────────────────────
  createSearchHandler('action-log-search', actionLogScroller,
    (item, query) => matchesSearch(item, query, ['action', 'files', 'outcome']),
    null
  );

  createSearchHandler('file-index-search', fileIndexScroller,
    (item, query) => matchesSearch(item, query, ['filePath', 'description']),
    (shown, total) => {
      const s = document.getElementById('file-index-showing');
      if (s) s.textContent = String(shown);
    }
  );

  createSelectFilter('file-index-dir-filter', fileIndexScroller,
    (item) => item.filePath || '',
    (shown, total) => {
      const s = document.getElementById('file-index-showing');
      if (s) s.textContent = String(shown);
    }
  );

  // Action log filter by action type
  const actionLogFilter = document.getElementById('action-log-filter');
  if (actionLogFilter) {
    actionLogFilter.addEventListener('change', () => {
      const val = actionLogFilter.value;
      const all = actionLogScroller.getAllItems();
      const filtered = val ? all.filter(item => (item.action || '').toLowerCase().includes(val)) : all;
      actionLogScroller.setFiltered(filtered);
    });
  }

  // Bug search
  const bugSearch = document.getElementById('bug-search');
  if (bugSearch) {
    const handler = debounce(() => {
      const query = bugSearch.value.trim();
      const bugs = Store.get('bugs') || [];
      const filtered = query
        ? bugs.filter(b => matchesSearch(b, query, ['errorMessage', 'rootCause', 'fixDescription', 'filePath', 'tags']))
        : bugs;
      renderBugs(filtered);
    }, 200);
    bugSearch.addEventListener('input', handler);
  }

  // Bug tag filter
  const bugTagFilter = document.getElementById('bug-tag-filter');
  if (bugTagFilter) {
    bugTagFilter.addEventListener('change', () => {
      const tag = bugTagFilter.value;
      const bugs = Store.get('bugs') || [];
      const filtered = tag ? bugs.filter(b => (b.tags || []).includes(tag)) : bugs;
      renderBugs(filtered);
    });
  }

  // ── Action Buttons (event delegation) ───────────────────
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;

    const action = btn.getAttribute('data-action');
    const taskId = btn.getAttribute('data-task-id');

    btn.disabled = true;
    btn.textContent = 'Running...';

    try {
      let url;
      if (action === 'run-task') url = '/api/tasks/' + encodeURIComponent(taskId) + '/run';
      else if (action === 'retry-dead-letter') url = '/api/dead-letter/' + encodeURIComponent(taskId) + '/retry';
      else if (action === 'rescan') url = '/api/rescan';
      else return;

      const res = await fetch(url, { method: 'POST' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      btn.textContent = 'Done!';
      setTimeout(() => {
        btn.disabled = false;
        btn.textContent = action === 'rescan' ? 'Force File Index Rescan' : action === 'retry-dead-letter' ? 'Retry' : 'Run';
      }, 1500);
    } catch (err) {
      btn.textContent = 'Error';
      btn.disabled = false;
      console.error('[mink] Action failed:', err);
      setTimeout(() => {
        btn.textContent = action === 'rescan' ? 'Force File Index Rescan' : action === 'retry-dead-letter' ? 'Retry' : 'Run';
      }, 2000);
    }
  });

  // ── Lightbox ────────────────────────────────────────────
  const lightbox = document.getElementById('design-lightbox');
  const lightboxImg = document.getElementById('lightbox-img');
  if (lightbox && lightboxImg) {
    document.addEventListener('click', (e) => {
      const card = e.target.closest('[data-lightbox-src]');
      if (card) {
        lightboxImg.src = card.getAttribute('data-lightbox-src');
        lightbox.style.display = 'flex';
      }
    });
    lightbox.addEventListener('click', () => {
      lightbox.style.display = 'none';
    });
  }

  // ── Connect SSE ─────────────────────────────────────────
  SSEClient.connect();
});
`;
}
