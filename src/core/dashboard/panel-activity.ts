/**
 * Panel 2: Activity Timeline — chronological session history.
 */
export function panelActivity(): string {
  return `
    <section class="panel" id="panel-activity">
      <h2 class="panel-title">Activity Timeline</h2>

      <div class="stat-grid" id="activity-summary">
        <div class="stat-card">
          <div class="stat-value" id="activity-total-sessions">—</div>
          <div class="stat-label">Sessions</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" id="activity-latest-date">—</div>
          <div class="stat-label">Latest Session</div>
        </div>
      </div>

      <div id="activity-list" style="max-height: calc(100vh - 240px); overflow-y: auto;">
        <div class="empty-state">Loading sessions...</div>
      </div>
    </section>`;
}
