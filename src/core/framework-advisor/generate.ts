import type {
  FrameworkAdvisorKnowledge,
  FrameworkEntry,
  DecisionTreeNode,
} from "../../types/framework-advisor";
import { FRAMEWORK_CATALOG } from "./catalog";
import { DECISION_TREE } from "./decision-tree";
import { MIGRATION_PROMPTS } from "./migration-prompts";

export function buildKnowledge(): FrameworkAdvisorKnowledge {
  return {
    version: "1.0.0",
    generatedAt: new Date().toISOString(),
    frameworks: FRAMEWORK_CATALOG,
    decisionTree: DECISION_TREE,
    migrationPrompts: MIGRATION_PROMPTS,
  };
}

// ── Markdown Generation ───────────────────────────────────────────────────

export function generateKnowledgeMarkdown(
  k: FrameworkAdvisorKnowledge
): string {
  const parts: string[] = [];

  parts.push(`# Framework Advisor Knowledge Base`);
  parts.push("");
  parts.push(
    `> Generated: ${k.generatedAt} | Version: ${k.version} | Frameworks: ${k.frameworks.length}`
  );
  parts.push("");

  // ── Comparison Matrix ─────────────────────────────────────────────────
  parts.push("## Comparison Matrix");
  parts.push("");
  parts.push(
    "| Framework | CSS Approach | Bundle | A11y | Dark Mode | TS | Learning Curve | Design Tokens |"
  );
  parts.push(
    "|-----------|-------------|--------|------|-----------|-----|---------------|---------------|"
  );

  for (const fw of k.frameworks) {
    parts.push(
      `| ${fw.name} | ${fw.cssApproach} | ${fw.bundleSize} | ${fw.accessibilityRating} | ${fw.darkModeSupport ? "yes" : "no"} | ${fw.typescriptSupport} | ${fw.learningCurve} | ${fw.designTokens ? "yes" : "no"} |`
    );
  }
  parts.push("");

  // ── Decision Tree ─────────────────────────────────────────────────────
  parts.push("## Decision Tree");
  parts.push("");
  parts.push(
    "Answer the following questions in order. Stop when you reach a recommendation."
  );
  parts.push("");

  for (let i = 0; i < k.decisionTree.length; i++) {
    const node = k.decisionTree[i];
    parts.push(`### Q: ${node.question}`);
    parts.push(`*(node: ${node.id})*`);
    parts.push("");
    for (const opt of node.options) {
      if (opt.recommends && opt.recommends.length > 0) {
        const names = opt.recommends
          .map((id) => frameworkName(k.frameworks, id))
          .join(", ");
        parts.push(`- **${opt.label}** → Recommend: **${names}**`);
      } else if (opt.nextNodeId) {
        parts.push(`- **${opt.label}** → Continue to *${opt.nextNodeId}*`);
      }
    }
    parts.push("");
  }

  // ── Framework Details ─────────────────────────────────────────────────
  parts.push("## Framework Details");
  parts.push("");

  for (const fw of k.frameworks) {
    parts.push(`### ${fw.name}`);
    parts.push("");
    parts.push(fw.description);
    parts.push("");
    parts.push(`- **Ecosystem:** ${fw.ecosystem}`);
    parts.push(
      `- **Best for:** ${fw.bestFor.join("; ")}`
    );
    parts.push(
      `- **Limitations:** ${fw.limitations.join("; ")}`
    );
    parts.push(`- **URL:** ${fw.officialUrl}`);
    parts.push("");
  }

  // ── Migration Prompts ─────────────────────────────────────────────────
  parts.push("## Migration Prompts");
  parts.push("");

  for (const prompt of k.migrationPrompts) {
    const fw = k.frameworks.find((f) => f.id === prompt.frameworkId);
    const name = fw ? fw.name : prompt.frameworkId;
    parts.push(`### ${name} Migration`);
    parts.push("");
    for (const section of prompt.sections) {
      parts.push(`**${sectionTitle(section.key)}**`);
      parts.push("");
      parts.push(section.content);
      parts.push("");
    }
  }

  return parts.join("\n");
}

function frameworkName(frameworks: FrameworkEntry[], id: string): string {
  const fw = frameworks.find((f) => f.id === id);
  return fw ? fw.name : id;
}

function sectionTitle(key: string): string {
  const titles: Record<string, string> = {
    install: "Installation",
    configure: "Configuration",
    "migrate-components": "Component Migration",
    "migrate-styles": "Style Migration",
    gotchas: "Known Gotchas",
    verification: "Verification",
  };
  return titles[key] ?? key;
}
