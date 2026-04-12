/**
 * SSE client with auto-reconnect and connection indicator management.
 */
export function jsSse(): string {
  return `
// ── Data Transformers ───────────────────────────────────────
function transformOverview(data) {
  return {
    projectName: (data.project && data.project.name) || '',
    daemonRunning: (data.daemon && data.daemon.running) || false,
    daemonUptime: (data.daemon && data.daemon.uptimeMs) || null
  };
}

function applySchedulerData(data) {
  var combined = data.tasks || [];
  Store.update('tasks', combined.map(function(t) { return t.state; }).filter(Boolean));
  Store.update('taskDefinitions', combined.map(function(t) { return t.definition; }).filter(Boolean));
  Store.update('deadLetters', data.deadLetterQueue || []);
}

function updateHealthFromOverview() {
  var ov = Store.get('overview');
  if (ov && ov.daemonRunning) {
    Store.update('health', { uptimeMs: ov.daemonUptime || 0 });
  } else {
    Store.update('health', null);
  }
}

function parseActionLogEntries(data) {
  var entries = [];
  var sessions = (data && data.sessions) || [];
  for (var s = 0; s < sessions.length; s++) {
    var lines = (sessions[s].content || '').split('\\n');
    for (var l = 0; l < lines.length; l++) {
      var line = lines[l];
      if (!line.startsWith('|') || line.indexOf('---') >= 0) continue;
      var cols = line.split('|').map(function(c) { return c.trim(); }).filter(Boolean);
      if (cols.length >= 5 && cols[0] !== 'Time') {
        entries.push({ time: cols[0], action: cols[1], files: cols[2], outcome: cols[3], tokens: cols[4] });
      }
    }
  }
  return entries;
}

// ── SSE Client ──────────────────────────────────────────────
const SSEClient = (() => {
  let eventSource = null;
  let reconnectDelay = 1000;
  const MAX_DELAY = 30000;
  let reconnectTimer = null;

  function updateIndicator(connected) {
    const dot = document.getElementById('connection-dot');
    const label = document.getElementById('connection-label');
    if (dot) {
      dot.classList.toggle('connected', connected);
    }
    if (label) {
      label.textContent = connected ? 'Connected' : 'Disconnected — reconnecting...';
    }
    Store.update('connected', connected);
  }

  function connect() {
    if (eventSource) {
      eventSource.close();
    }

    eventSource = new EventSource('/api/events');

    eventSource.onopen = () => {
      reconnectDelay = 1000;
      updateIndicator(true);
      // Refresh all data on reconnect
      fetchAllData();
    };

    eventSource.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === 'keepalive') return;
        handleEvent(payload);
      } catch (e) {
        console.warn('[mink] SSE parse error:', e);
      }
    };

    eventSource.onerror = () => {
      updateIndicator(false);
      eventSource.close();
      eventSource = null;
      scheduleReconnect();
    };
  }

  function scheduleReconnect() {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
      reconnectDelay = Math.min(reconnectDelay * 2, MAX_DELAY);
      connect();
    }, reconnectDelay);
  }

  function handleEvent(payload) {
    const fileId = payload.fileId || payload.type;
    switch (fileId) {
      case 'token-ledger':
        fetchApi('/api/token-ledger', data => Store.update('ledger', data));
        break;
      case 'file-index':
        fetchApi('/api/file-index', data => Store.update('fileIndex', data));
        break;
      case 'scheduler-manifest':
        fetchApi('/api/scheduler', function(data) { applySchedulerData(data); });
        break;
      case 'learning-memory':
        fetchApi('/api/learning-memory', data => Store.update('learningMemory', data));
        break;
      case 'action-log':
        fetchApi('/api/action-log', function(data) { Store.update('actionLog', parseActionLogEntries(data)); });
        break;
      case 'bug-memory':
        fetchApi('/api/bugs', function(data) { Store.update('bugs', data.entries || []); });
        break;
      case 'session':
        fetchApi('/api/overview', function(data) {
          Store.update('overview', transformOverview(data));
          updateHealthFromOverview();
        });
        break;
      case 'design-report':
        fetchApi('/api/design', data => Store.update('designImages', data.images));
        break;
      default:
        // Unknown event type — refresh everything
        fetchAllData();
    }
  }

  function fetchApi(path, onSuccess) {
    fetch(path)
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(onSuccess)
      .catch(e => console.warn('[mink] API fetch error:', path, e));
  }

  function fetchAllData() {
    fetchApi('/api/overview', function(data) {
      Store.update('overview', transformOverview(data));
      updateHealthFromOverview();
    });
    fetchApi('/api/token-ledger', function(data) { Store.update('ledger', data); });
    fetchApi('/api/file-index', function(data) { Store.update('fileIndex', data); });
    fetchApi('/api/scheduler', function(data) { applySchedulerData(data); });
    fetchApi('/api/learning-memory', function(data) { Store.update('learningMemory', data); });
    fetchApi('/api/action-log', function(data) { Store.update('actionLog', parseActionLogEntries(data)); });
    fetchApi('/api/bugs', function(data) { Store.update('bugs', data.entries || []); });
    fetchApi('/api/design', function(data) { Store.update('designImages', data.images); });
  }

  return { connect, fetchAllData };
})();
`;
}
