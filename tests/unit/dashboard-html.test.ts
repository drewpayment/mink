import { describe, test, expect } from "bun:test";
import { getDashboardHtml } from "../../src/core/dashboard/get-dashboard-html";

describe("getDashboardHtml", () => {
  const html = getDashboardHtml();

  test("returns a complete HTML document", () => {
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<html lang=\"en\">");
    expect(html).toContain("</html>");
  });

  test("contains style and script tags", () => {
    expect(html).toContain("<style>");
    expect(html).toContain("</style>");
    expect(html).toContain("<script>");
    expect(html).toContain("</script>");
  });

  test("contains all 10 panel containers", () => {
    const panelIds = [
      "panel-overview",
      "panel-activity",
      "panel-tokens",
      "panel-scheduler",
      "panel-learning",
      "panel-action-log",
      "panel-file-index",
      "panel-bugs",
      "panel-insights",
      "panel-design",
    ];
    for (const id of panelIds) {
      expect(html).toContain(`id="${id}"`);
    }
  });

  test("contains sidebar navigation links", () => {
    expect(html).toContain('data-panel="overview"');
    expect(html).toContain('data-panel="tokens"');
    expect(html).toContain('data-panel="bugs"');
  });

  test("contains theme CSS variables", () => {
    expect(html).toContain("--bg:");
    expect(html).toContain("--fg:");
    expect(html).toContain("--accent:");
    expect(html).toContain("--surface:");
    expect(html).toContain("--border:");
  });

  test("contains dark theme support", () => {
    expect(html).toContain('[data-theme="dark"]');
    expect(html).toContain("prefers-color-scheme: dark");
  });

  test("contains SSE client (EventSource)", () => {
    expect(html).toContain("EventSource");
    expect(html).toContain("/api/events");
  });

  test("contains reactive store", () => {
    expect(html).toContain("Store");
    expect(html).toContain("subscribe");
    expect(html).toContain("update");
  });

  test("contains chart rendering functions", () => {
    expect(html).toContain("renderBarChart");
    expect(html).toContain("renderLineChart");
    expect(html).toContain("renderDonutChart");
  });

  test("contains virtual scroll engine", () => {
    expect(html).toContain("createVirtualScroller");
    expect(html).toContain("virtual-viewport");
  });

  test("contains connection indicator", () => {
    expect(html).toContain("connection-dot");
    expect(html).toContain("connection-label");
  });

  test("contains theme toggle button", () => {
    expect(html).toContain("theme-toggle");
    expect(html).toContain("toggleTheme");
  });

  test("contains action endpoints for scheduler", () => {
    expect(html).toContain("data-action");
    expect(html).toContain("/api/tasks/");
    expect(html).toContain("/api/rescan");
  });
});
