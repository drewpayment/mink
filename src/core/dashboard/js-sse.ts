/**
 * SSE client with auto-reconnect and connection indicator management.
 */
export function jsSse(): string {
  return `
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
        fetchApi('/api/scheduler', data => {
          if (data.tasks) Store.update('tasks', data.tasks);
          if (data.taskDefinitions) Store.update('taskDefinitions', data.taskDefinitions);
          if (data.deadLetters) Store.update('deadLetters', data.deadLetters);
          if (data.health) Store.update('health', data.health);
        });
        break;
      case 'learning-memory':
        fetchApi('/api/learning-memory', data => Store.update('learningMemory', data));
        break;
      case 'action-log':
        fetchApi('/api/action-log', data => Store.update('actionLog', data));
        break;
      case 'bug-memory':
        fetchApi('/api/bugs', data => Store.update('bugs', data));
        break;
      case 'session':
        fetchApi('/api/overview', data => Store.update('overview', data));
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
    fetchApi('/api/overview', data => Store.update('overview', data));
    fetchApi('/api/token-ledger', data => Store.update('ledger', data));
    fetchApi('/api/file-index', data => Store.update('fileIndex', data));
    fetchApi('/api/scheduler', data => {
      if (data.tasks) Store.update('tasks', data.tasks);
      if (data.taskDefinitions) Store.update('taskDefinitions', data.taskDefinitions);
      if (data.deadLetters) Store.update('deadLetters', data.deadLetters);
      if (data.health) Store.update('health', data.health);
    });
    fetchApi('/api/learning-memory', data => Store.update('learningMemory', data));
    fetchApi('/api/action-log', data => Store.update('actionLog', data));
    fetchApi('/api/bugs', data => Store.update('bugs', data));
  }

  return { connect, fetchAllData };
})();
`;
}
