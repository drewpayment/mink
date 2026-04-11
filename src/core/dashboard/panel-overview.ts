/**
 * Panel 1: Overview — daemon status, project info, summary stat cards.
 */
export function panelOverview(): string {
  return `
    <section class="panel active" id="panel-overview">
      <h2 class="panel-title">Overview</h2>

      <div class="card" id="daemon-status-card">
        <div style="display:flex; align-items:center; justify-content:space-between;">
          <div>
            <strong>Daemon Status</strong>
            <div id="daemon-detail" style="font-size:0.8rem; color:var(--fg-muted); margin-top:2px;">Checking...</div>
          </div>
          <span class="badge badge-idle" id="daemon-status">unknown</span>
        </div>
      </div>

      <div class="stat-grid">
        <div class="stat-card">
          <div class="stat-value" id="stat-sessions">—</div>
          <div class="stat-label">Total Sessions</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" id="stat-tokens">—</div>
          <div class="stat-label">Total Tokens</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" id="stat-savings">—</div>
          <div class="stat-label">Estimated Savings</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" id="stat-reads">—</div>
          <div class="stat-label">Total Reads</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" id="stat-writes">—</div>
          <div class="stat-label">Total Writes</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" id="stat-files">—</div>
          <div class="stat-label">Indexed Files</div>
        </div>
      </div>

      <div class="card">
        <strong>Project</strong>
        <div id="project-name" style="font-size:0.85rem; color:var(--fg-muted); margin-top:4px;">—</div>
      </div>
    </section>`;
}
