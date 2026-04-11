/**
 * Panel 5: Learning Memory Viewer — four collapsible sections.
 */
export function panelLearning(): string {
  const sections = [
    { id: "learning-prefs", label: "User Preferences" },
    { id: "learning-learnings", label: "Key Learnings" },
    { id: "learning-donotrepeat", label: "Do-Not-Repeat" },
    { id: "learning-decisions", label: "Decision Log" },
  ];

  const details = sections
    .map(
      (s) => `
      <details>
        <summary>${s.label} <span id="${s.id}-count" style="font-size:0.75rem; color:var(--fg-muted); font-weight:400;">(0)</span></summary>
        <div class="detail-content">
          <ul id="${s.id}">
            <li class="empty-state" style="list-style:none;">No entries yet</li>
          </ul>
        </div>
      </details>`
    )
    .join("\n");

  return `
    <section class="panel" id="panel-learning">
      <h2 class="panel-title">Learning Memory</h2>

      <div class="card" id="learning-project">
        <strong>Project:</strong> <span id="learning-project-name">—</span>
      </div>

${details}
    </section>`;
}
