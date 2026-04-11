/**
 * Composition entry point: imports all dashboard modules and
 * concatenates them into a single self-contained HTML page.
 */
import { cssBase } from "./css-base";
import { cssThemes } from "./css-themes";
import { htmlShell } from "./html-shell";
import { htmlLayout } from "./html-layout";
import { panelOverview } from "./panel-overview";
import { panelActivity } from "./panel-activity";
import { panelTokens } from "./panel-tokens";
import { panelScheduler } from "./panel-scheduler";
import { panelLearning } from "./panel-learning";
import { panelActionLog } from "./panel-action-log";
import { panelFileIndex } from "./panel-file-index";
import { panelBugs } from "./panel-bugs";
import { panelInsights } from "./panel-insights";
import { panelDesign } from "./panel-design";
import { jsStore } from "./js-store";
import { jsSse } from "./js-sse";
import { jsCharts } from "./js-charts";
import { jsVirtualScroll } from "./js-virtual-scroll";
import { jsSearch } from "./js-search";
import { jsPanelsA } from "./js-panels-a";
import { jsPanelsB } from "./js-panels-b";
import { jsInit } from "./js-init";

export function getDashboardHtml(): string {
  const css = cssBase() + cssThemes();

  const panels = [
    panelOverview(),
    panelActivity(),
    panelTokens(),
    panelScheduler(),
    panelLearning(),
    panelActionLog(),
    panelFileIndex(),
    panelBugs(),
    panelInsights(),
    panelDesign(),
  ].join("\n");

  const body = htmlLayout(panels);

  // JS must be concatenated in dependency order:
  // store → sse → charts → virtual-scroll → search → panel renderers → init
  const js = [
    jsStore(),
    jsSse(),
    jsCharts(),
    jsVirtualScroll(),
    jsSearch(),
    jsPanelsA(),
    jsPanelsB(),
    jsInit(),
  ].join("\n");

  return htmlShell({ css, body, js });
}
