/**
 * Panel 8: Bug Log — searchable list with expandable detail cards.
 */
export function panelBugs(): string {
  return `
    <section class="panel" id="panel-bugs">
      <h2 class="panel-title">Bug Log</h2>

      <div class="stat-grid" id="bug-summary">
        <div class="stat-card">
          <div class="stat-value" id="bug-total">—</div>
          <div class="stat-label">Total Bugs</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" id="bug-total-occurrences">—</div>
          <div class="stat-label">Total Occurrences</div>
        </div>
      </div>

      <div class="search-bar">
        <input type="text" class="search-input" id="bug-search"
               placeholder="Search errors, root causes, tags..." />
        <select class="filter-select" id="bug-tag-filter">
          <option value="">All Tags</option>
        </select>
      </div>

      <div style="font-size:0.75rem; color:var(--fg-muted); margin-bottom:8px;">
        Showing <span id="bug-showing">0</span> of <span id="bug-of">0</span> bugs
      </div>

      <div id="bug-list" style="max-height: calc(100vh - 380px); overflow-y: auto;">
        <div class="empty-state">Loading bugs...</div>
      </div>
    </section>`;
}
