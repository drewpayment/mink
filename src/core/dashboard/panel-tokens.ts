/**
 * Panel 3: Token Intelligence — headline stats and SVG chart containers.
 */
export function panelTokens(): string {
  return `
    <section class="panel" id="panel-tokens">
      <h2 class="panel-title">Token Intelligence</h2>

      <div class="stat-grid">
        <div class="stat-card">
          <div class="stat-value" id="token-total">—</div>
          <div class="stat-label">Lifetime Tokens</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" id="token-savings">—</div>
          <div class="stat-label">Est. Savings</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" id="token-read-write">—</div>
          <div class="stat-label">Read / Write Ratio</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" id="token-session-count">—</div>
          <div class="stat-label">Sessions Tracked</div>
        </div>
      </div>

      <div class="chart-grid">
        <div class="chart-container">
          <div class="chart-title">Token Usage Per Session</div>
          <div id="chart-usage" style="height:200px;">
            <div class="empty-state">Loading chart...</div>
          </div>
        </div>
        <div class="chart-container">
          <div class="chart-title">Read vs Write Split</div>
          <div id="chart-readwrite" style="height:200px;">
            <div class="empty-state">Loading chart...</div>
          </div>
        </div>
      </div>

      <div class="chart-container">
        <div class="chart-title">Cumulative Usage &amp; Savings</div>
        <div id="chart-savings" style="height:220px;">
          <div class="empty-state">Loading chart...</div>
        </div>
      </div>
    </section>`;
}
