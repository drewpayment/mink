/**
 * Panel 9: AI Insights — waste detection flags displayed as cards.
 */
export function panelInsights(): string {
  return `
    <section class="panel" id="panel-insights">
      <h2 class="panel-title">AI Insights</h2>

      <div class="stat-grid" id="insights-summary">
        <div class="stat-card">
          <div class="stat-value" id="insights-count">—</div>
          <div class="stat-label">Active Flags</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" id="insights-wasted">—</div>
          <div class="stat-label">Est. Tokens Wasted</div>
        </div>
      </div>

      <div id="insights-list">
        <div class="empty-state">No insights available. Run the waste detection task to generate insights.</div>
      </div>
    </section>`;
}
