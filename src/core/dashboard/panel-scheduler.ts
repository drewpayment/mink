/**
 * Panel 4: Scheduler Control — task table with run/retry actions, dead letter queue.
 */
export function panelScheduler(): string {
  return `
    <section class="panel" id="panel-scheduler">
      <h2 class="panel-title">Scheduler Control</h2>

      <div class="card" id="scheduler-health-card">
        <div style="display:flex; align-items:center; justify-content:space-between;">
          <div>
            <strong>Daemon Health</strong>
            <div id="scheduler-uptime" style="font-size:0.8rem; color:var(--fg-muted); margin-top:2px;">—</div>
          </div>
          <span class="badge badge-idle" id="scheduler-daemon-badge">unknown</span>
        </div>
      </div>

      <div class="card">
        <h3 style="font-size:0.9rem; font-weight:600; margin-bottom:10px;">Scheduled Tasks</h3>
        <div style="overflow-x:auto;">
          <table class="data-table">
            <thead>
              <tr>
                <th>Task</th>
                <th>Schedule</th>
                <th>Status</th>
                <th>Last Run</th>
                <th>Next Run</th>
                <th>Failures</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody id="task-table-body">
              <tr><td colspan="7" class="empty-state">Loading tasks...</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <h3 style="font-size:0.9rem; font-weight:600; margin-bottom:10px;">
          Dead Letter Queue
          <span class="badge badge-idle" id="dead-letter-count" style="margin-left:8px;">0</span>
        </h3>
        <div id="dead-letter-list">
          <div class="empty-state">No dead-lettered tasks</div>
        </div>
      </div>

      <div style="margin-top:12px;">
        <button class="btn" id="btn-rescan" data-action="rescan">Force File Index Rescan</button>
      </div>
    </section>`;
}
