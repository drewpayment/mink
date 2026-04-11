/**
 * Panel 6: Action Log Browser — searchable table with virtual scrolling.
 */
export function panelActionLog(): string {
  return `
    <section class="panel" id="panel-action-log">
      <h2 class="panel-title">Action Log</h2>

      <div class="stat-grid" id="action-log-summary">
        <div class="stat-card">
          <div class="stat-value" id="action-log-total">—</div>
          <div class="stat-label">Total Entries</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" id="action-log-session-count">—</div>
          <div class="stat-label">Sessions</div>
        </div>
      </div>

      <div class="search-bar">
        <input type="text" class="search-input" id="action-log-search"
               placeholder="Search actions, files, outcomes..." />
        <select class="filter-select" id="action-log-filter">
          <option value="">All Actions</option>
          <option value="read">Read</option>
          <option value="write">Write</option>
          <option value="create">Create</option>
          <option value="edit">Edit</option>
        </select>
      </div>

      <div class="card" style="padding:0; overflow:hidden;">
        <table class="data-table">
          <thead>
            <tr>
              <th style="width:60px;">Time</th>
              <th style="width:80px;">Action</th>
              <th>File(s)</th>
              <th style="width:80px;">Outcome</th>
              <th style="width:70px;">~Tokens</th>
            </tr>
          </thead>
        </table>
        <div class="virtual-viewport" id="action-log-viewport"
             style="height: calc(100vh - 380px); min-height: 300px;">
          <div class="virtual-spacer" id="action-log-spacer"></div>
          <div class="virtual-content" id="action-log-content">
            <div class="empty-state">Loading action log...</div>
          </div>
        </div>
      </div>
    </section>`;
}
