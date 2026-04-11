/**
 * Client-side reactive data store with theme persistence.
 * Defines window.Store used by all other JS modules.
 */
export function jsStore(): string {
  return `
// ── Store ───────────────────────────────────────────────────
const Store = (() => {
  const state = {
    connected: false,
    theme: 'light',
    overview: { projectName: '', daemonRunning: false, daemonUptime: null },
    ledger: { lifetime: null, sessions: [] },
    tasks: [],
    taskDefinitions: [],
    deadLetters: [],
    health: null,
    learningMemory: { projectName: '', sections: {} },
    actionLog: [],
    fileIndex: { header: null, entries: {} },
    bugs: [],
    wasteFlags: [],
    designImages: [],
  };

  const listeners = {};

  function subscribe(key, fn) {
    if (!listeners[key]) listeners[key] = [];
    listeners[key].push(fn);
    // Immediately invoke with current value
    fn(state[key]);
  }

  function update(key, value) {
    state[key] = value;
    if (listeners[key]) {
      listeners[key].forEach(fn => fn(value));
    }
  }

  function get(key) {
    return state[key];
  }

  // ── Theme ───────────────────────────────────────────────
  function initTheme() {
    const saved = localStorage.getItem('mink-theme');
    if (saved === 'dark' || saved === 'light') {
      state.theme = saved;
    } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      state.theme = 'dark';
    }
    applyTheme();
  }

  function toggleTheme() {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('mink-theme', state.theme);
    applyTheme();
    if (listeners.theme) listeners.theme.forEach(fn => fn(state.theme));
  }

  function applyTheme() {
    if (state.theme === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
  }

  return { state, subscribe, update, get, initTheme, toggleTheme };
})();
`;
}
