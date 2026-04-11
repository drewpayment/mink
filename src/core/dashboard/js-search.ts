/**
 * Search and filter utilities with debounce.
 */
export function jsSearch(): string {
  return `
// ── Search / Filter ─────────────────────────────────────────
function debounce(fn, ms) {
  let timer;
  return function(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), ms);
  };
}

function matchesSearch(item, query, fields) {
  if (!query) return true;
  const lower = query.toLowerCase();
  return fields.some(field => {
    const val = item[field];
    if (val == null) return false;
    if (Array.isArray(val)) return val.some(v => String(v).toLowerCase().includes(lower));
    return String(val).toLowerCase().includes(lower);
  });
}

function createSearchHandler(inputId, scroller, filterFn, countUpdater) {
  const input = document.getElementById(inputId);
  if (!input) return;

  const handler = debounce(() => {
    const query = input.value.trim();
    const all = scroller.getAllItems();
    const filtered = query ? all.filter(item => filterFn(item, query)) : all;
    scroller.setFiltered(filtered);
    if (countUpdater) countUpdater(filtered.length, all.length);
  }, 200);

  input.addEventListener('input', handler);
  return handler;
}

function createSelectFilter(selectId, scroller, getField, countUpdater) {
  const select = document.getElementById(selectId);
  if (!select) return;

  select.addEventListener('change', () => {
    const val = select.value;
    const all = scroller.getAllItems();
    const filtered = val ? all.filter(item => getField(item) === val || getField(item).startsWith(val + '/')) : all;
    scroller.setFiltered(filtered);
    if (countUpdater) countUpdater(filtered.length, all.length);
  });
}

function populateDirectoryFilter(selectId, entries) {
  const select = document.getElementById(selectId);
  if (!select) return;

  const dirs = new Set();
  entries.forEach(e => {
    const path = e.filePath || e.path || '';
    const parts = path.split('/');
    if (parts.length > 1) {
      dirs.add(parts[0]);
      if (parts.length > 2) dirs.add(parts[0] + '/' + parts[1]);
    }
  });

  const sorted = [...dirs].sort();
  // Preserve first "All" option, replace the rest
  const firstOption = select.options[0];
  select.innerHTML = '';
  select.appendChild(firstOption);
  sorted.forEach(dir => {
    const opt = document.createElement('option');
    opt.value = dir;
    opt.textContent = dir + '/';
    select.appendChild(opt);
  });
}
`;
}
