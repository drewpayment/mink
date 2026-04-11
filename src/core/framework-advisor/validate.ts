import type {
  FrameworkAdvisorKnowledge,
  FrameworkEntry,
  ValidationResult,
} from "../../types/framework-advisor";
import { MIGRATION_SECTION_KEYS } from "../../types/framework-advisor";

const REQUIRED_FRAMEWORK_STRINGS: (keyof FrameworkEntry)[] = [
  "id",
  "name",
  "description",
  "cssApproach",
  "accessibilityRating",
  "bundleSize",
  "learningCurve",
  "typescriptSupport",
  "ecosystem",
  "officialUrl",
];

export function validateKnowledge(
  k: FrameworkAdvisorKnowledge
): ValidationResult {
  const errors: string[] = [];

  // ── Framework completeness ──────────────────────────────────────────────
  if (k.frameworks.length < 12) {
    errors.push(
      `Framework catalog has ${k.frameworks.length} entries, minimum 12 required`
    );
  }

  const ids = new Set<string>();
  for (const fw of k.frameworks) {
    if (ids.has(fw.id)) {
      errors.push(`Duplicate framework ID: "${fw.id}"`);
    }
    ids.add(fw.id);

    for (const field of REQUIRED_FRAMEWORK_STRINGS) {
      const val = fw[field];
      if (typeof val === "string" && val.trim() === "") {
        errors.push(`Framework "${fw.id}" has empty field: ${field}`);
      }
    }

    if (fw.bestFor.length === 0) {
      errors.push(`Framework "${fw.id}" has no bestFor entries`);
    }
    if (fw.limitations.length === 0) {
      errors.push(`Framework "${fw.id}" has no limitations entries`);
    }
  }

  // ── Decision tree integrity ─────────────────────────────────────────────
  const nodeMap = new Map(k.decisionTree.map((n) => [n.id, n]));

  for (const node of k.decisionTree) {
    for (const opt of node.options) {
      if (opt.nextNodeId !== null && !nodeMap.has(opt.nextNodeId)) {
        errors.push(
          `Decision tree node "${node.id}" references unknown node: "${opt.nextNodeId}"`
        );
      }
      if (opt.nextNodeId === null && (!opt.recommends || opt.recommends.length === 0)) {
        errors.push(
          `Decision tree node "${node.id}" option "${opt.value}" is terminal but has no recommendations`
        );
      }
      if (opt.recommends) {
        for (const fwId of opt.recommends) {
          if (!ids.has(fwId)) {
            errors.push(
              `Decision tree recommends unknown framework: "${fwId}"`
            );
          }
        }
      }
    }
  }

  // Verify all paths from root reach a terminal
  if (k.decisionTree.length > 0) {
    const rootId = k.decisionTree[0].id;
    const visited = new Set<string>();

    function checkPath(nodeId: string): void {
      if (visited.has(nodeId)) return;
      visited.add(nodeId);
      const node = nodeMap.get(nodeId);
      if (!node) return;
      for (const opt of node.options) {
        if (opt.nextNodeId !== null) {
          checkPath(opt.nextNodeId);
        }
      }
    }

    checkPath(rootId);

    for (const node of k.decisionTree) {
      if (!visited.has(node.id)) {
        errors.push(`Decision tree node "${node.id}" is unreachable from root`);
      }
    }
  }

  // ── Migration prompt coverage ───────────────────────────────────────────
  const promptMap = new Map(k.migrationPrompts.map((p) => [p.frameworkId, p]));

  for (const fw of k.frameworks) {
    const prompt = promptMap.get(fw.id);
    if (!prompt) {
      errors.push(`Framework "${fw.id}" has no migration prompt`);
      continue;
    }

    const sectionKeys = new Set(prompt.sections.map((s) => s.key));
    for (const required of MIGRATION_SECTION_KEYS) {
      if (!sectionKeys.has(required)) {
        errors.push(
          `Migration prompt for "${fw.id}" is missing section: "${required}"`
        );
      }
    }

    for (const section of prompt.sections) {
      if (section.content.trim() === "") {
        errors.push(
          `Migration prompt for "${fw.id}" has empty section: "${section.key}"`
        );
      }
    }
  }

  return { valid: errors.length === 0, errors };
}
