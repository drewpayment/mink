/**
 * Panel 7: File Index Browser — searchable list with directory filter and virtual scrolling.
 */
export function panelFileIndex(): string {
  return `
    <section class="panel" id="panel-file-index">
      <h2 class="panel-title">File Index</h2>

      <div class="stat-grid" id="file-index-stats">
        <div class="stat-card">
          <div class="stat-value" id="file-index-total">—</div>
          <div class="stat-label">Indexed Files</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" id="file-index-last-scan">—</div>
          <div class="stat-label">Last Scan</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" id="file-index-hit-ratio">—</div>
          <div class="stat-label">Hit Ratio</div>
        </div>
      </div>

      <div class="search-bar">
        <input type="text" class="search-input" id="file-index-search"
               placeholder="Search files by name or description..." />
        <select class="filter-select" id="file-index-dir-filter">
          <option value="">All Directories</option>
        </select>
      </div>

      <div style="font-size:0.75rem; color:var(--fg-muted); margin-bottom:8px;">
        Showing <span id="file-index-showing">0</span> of <span id="file-index-of">0</span> files
      </div>

      <div class="virtual-viewport" id="file-index-viewport"
           style="height: calc(100vh - 380px); min-height: 300px;">
        <div class="virtual-spacer" id="file-index-spacer"></div>
        <div class="virtual-content" id="file-index-content">
          <div class="empty-state">Loading file index...</div>
        </div>
      </div>
    </section>`;
}
