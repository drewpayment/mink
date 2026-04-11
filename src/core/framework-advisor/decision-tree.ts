// ── Decision Tree for Framework Advisor (Spec 14) ────────────────────────────

import type { DecisionTreeNode, FrameworkEntry } from "../../types/framework-advisor";
import { getFrameworkById } from "./catalog";

// ── Tree Nodes ───────────────────────────────────────────────────────────────

export const DECISION_TREE: DecisionTreeNode[] = [
  {
    id: "component-model",
    question: "What component model does your project use?",
    options: [
      { label: "React", value: "react", nextNodeId: "react-css" },
      { label: "Vue", value: "vue", nextNodeId: "vue-css" },
      {
        label: "Svelte",
        value: "svelte",
        nextNodeId: null,
        recommends: ["skeleton-svelte"],
      },
      {
        label: "Angular",
        value: "angular",
        nextNodeId: null,
        recommends: ["angular-material"],
      },
      {
        label: "Any/Framework-agnostic",
        value: "agnostic",
        nextNodeId: "agnostic-css",
      },
    ],
  },
  {
    id: "react-css",
    question: "What CSS approach do you prefer?",
    options: [
      {
        label: "Utility-first (Tailwind)",
        value: "utility-first",
        nextNodeId: "react-utility-a11y",
      },
      {
        label: "CSS-in-JS",
        value: "css-in-js",
        nextNodeId: "react-cssjs-a11y",
      },
      {
        label: "CSS Modules",
        value: "css-modules",
        nextNodeId: null,
        recommends: ["mantine"],
      },
      {
        label: "No preference",
        value: "no-preference",
        nextNodeId: "react-utility-a11y",
      },
    ],
  },
  {
    id: "react-utility-a11y",
    question: "How important is accessibility compliance?",
    options: [
      {
        label: "Critical (WCAG AA+)",
        value: "critical",
        nextNodeId: "react-utility-critical-bundle",
      },
      {
        label: "Important",
        value: "important",
        nextNodeId: null,
        recommends: ["shadcn-ui", "tailwind-headlessui"],
      },
      {
        label: "Basic is fine",
        value: "basic",
        nextNodeId: null,
        recommends: ["shadcn-ui"],
      },
    ],
  },
  {
    id: "react-utility-critical-bundle",
    question: "How sensitive are you to bundle size?",
    options: [
      {
        label: "Very sensitive",
        value: "very-sensitive",
        nextNodeId: null,
        recommends: ["radix-ui", "tailwind-headlessui"],
      },
      {
        label: "Somewhat",
        value: "somewhat",
        nextNodeId: null,
        recommends: ["shadcn-ui", "radix-ui"],
      },
      {
        label: "Not concerned",
        value: "not-concerned",
        nextNodeId: null,
        recommends: ["shadcn-ui"],
      },
    ],
  },
  {
    id: "react-cssjs-a11y",
    question: "How important is accessibility compliance?",
    options: [
      {
        label: "Critical",
        value: "critical",
        nextNodeId: null,
        recommends: ["chakra-ui"],
      },
      {
        label: "Important",
        value: "important",
        nextNodeId: "react-cssjs-maturity",
      },
      {
        label: "Basic is fine",
        value: "basic",
        nextNodeId: "react-cssjs-maturity",
      },
    ],
  },
  {
    id: "react-cssjs-maturity",
    question: "Do you prefer battle-tested or modern?",
    options: [
      {
        label: "Battle-tested",
        value: "battle-tested",
        nextNodeId: null,
        recommends: ["mui"],
      },
      {
        label: "Modern",
        value: "modern",
        nextNodeId: null,
        recommends: ["chakra-ui"],
      },
      {
        label: "Enterprise-focused",
        value: "enterprise",
        nextNodeId: null,
        recommends: ["ant-design"],
      },
    ],
  },
  {
    id: "vue-css",
    question: "What CSS approach do you prefer?",
    options: [
      {
        label: "Utility-first",
        value: "utility-first",
        nextNodeId: null,
        recommends: ["vuetify"],
      },
      {
        label: "Traditional/Scoped",
        value: "traditional",
        nextNodeId: "vue-scale",
      },
      {
        label: "No preference",
        value: "no-preference",
        nextNodeId: "vue-scale",
      },
    ],
  },
  {
    id: "vue-scale",
    question: "What scale is your application?",
    options: [
      {
        label: "Enterprise / large component library needed",
        value: "enterprise",
        nextNodeId: null,
        recommends: ["primevue"],
      },
      {
        label: "Standard / Material Design",
        value: "standard",
        nextNodeId: null,
        recommends: ["vuetify"],
      },
    ],
  },
  {
    id: "agnostic-css",
    question: "What CSS approach do you prefer?",
    options: [
      {
        label: "Utility-first (Tailwind)",
        value: "utility-first",
        nextNodeId: "agnostic-bundle",
      },
      {
        label: "Other",
        value: "other",
        nextNodeId: null,
        recommends: ["park-ui"],
      },
    ],
  },
  {
    id: "agnostic-bundle",
    question: "How sensitive are you to bundle size?",
    options: [
      {
        label: "Very sensitive",
        value: "very-sensitive",
        nextNodeId: null,
        recommends: ["daisyui", "flowbite"],
      },
      {
        label: "Not very",
        value: "not-very",
        nextNodeId: null,
        recommends: ["flowbite", "park-ui"],
      },
    ],
  },
];

// ── Traversal ────────────────────────────────────────────────────────────────

const nodeIndex = new Map<string, DecisionTreeNode>(
  DECISION_TREE.map((n) => [n.id, n]),
);

/**
 * Walk the decision tree using the provided answers map.
 * Returns an array of recommended framework IDs, or [] if the answers
 * don't reach a terminal node.
 */
export function traverseDecisionTree(
  answers: Record<string, string>,
): string[] {
  let currentNodeId: string | null = "component-model";

  while (currentNodeId !== null) {
    const node = nodeIndex.get(currentNodeId);
    if (!node) {
      return [];
    }

    const answer = answers[node.id];
    if (answer === undefined || answer === null) {
      // No answer for this node — tree traversal is incomplete
      return [];
    }

    const matched = node.options.find((o) => o.value === answer);
    if (!matched) {
      // Answer doesn't match any option — treat as incomplete
      return [];
    }

    if (matched.recommends) {
      return matched.recommends;
    }

    currentNodeId = matched.nextNodeId;
  }

  // Reached a null nextNodeId without recommends — shouldn't happen
  // with a well-formed tree, but handle gracefully.
  return [];
}

/**
 * Resolve framework IDs from the decision tree into full FrameworkEntry objects.
 */
export function getRecommendations(
  answers: Record<string, string>,
): FrameworkEntry[] {
  const ids = traverseDecisionTree(answers);
  return ids
    .map((id) => getFrameworkById(id))
    .filter((f): f is FrameworkEntry => f !== undefined);
}
