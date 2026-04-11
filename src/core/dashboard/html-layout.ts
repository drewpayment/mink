/**
 * Page layout: sidebar navigation, header bar, and main content container.
 * The `panels` argument is the concatenated HTML of all panel sections.
 */
export function htmlLayout(panels: string): string {
  const navItems = [
    { id: "overview", label: "Overview" },
    { id: "activity", label: "Activity Timeline" },
    { id: "tokens", label: "Token Intelligence" },
    { id: "scheduler", label: "Scheduler Control" },
    { id: "learning", label: "Learning Memory" },
    { id: "action-log", label: "Action Log" },
    { id: "file-index", label: "File Index" },
    { id: "bugs", label: "Bug Log" },
    { id: "insights", label: "AI Insights" },
    { id: "design", label: "Design Evaluation" },
  ];

  const navLinks = navItems
    .map(
      (item, i) =>
        `    <a href="#${item.id}" data-panel="${item.id}"${i === 0 ? ' class="active"' : ""}>${item.label}</a>`
    )
    .join("\n");

  return `
  <nav class="sidebar">
    <div class="sidebar-brand">mink</div>
${navLinks}
  </nav>

  <header class="header">
    <h1>Dashboard</h1>
    <div class="header-right">
      <div class="connection-indicator">
        <span class="connection-dot" id="connection-dot"></span>
        <span id="connection-label">Connecting...</span>
      </div>
      <button class="theme-toggle" id="theme-toggle">Toggle Theme</button>
    </div>
  </header>

  <main class="main">
${panels}
  </main>`;
}
