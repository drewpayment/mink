import { describe, test, expect } from "bun:test";
import {
  DECISION_TREE,
  traverseDecisionTree,
  getRecommendations,
} from "../../../src/core/framework-advisor/decision-tree";
import { FRAMEWORK_CATALOG } from "../../../src/core/framework-advisor/catalog";

describe("DECISION_TREE", () => {
  test("has a root node with id 'component-model'", () => {
    expect(DECISION_TREE[0].id).toBe("component-model");
  });

  test("all nextNodeId references point to existing nodes", () => {
    const nodeIds = new Set(DECISION_TREE.map((n) => n.id));
    for (const node of DECISION_TREE) {
      for (const opt of node.options) {
        if (opt.nextNodeId !== null) {
          expect(nodeIds.has(opt.nextNodeId)).toBe(true);
        }
      }
    }
  });

  test("all recommended framework IDs exist in catalog", () => {
    const catalogIds = new Set(FRAMEWORK_CATALOG.map((f) => f.id));
    for (const node of DECISION_TREE) {
      for (const opt of node.options) {
        if (opt.recommends) {
          for (const id of opt.recommends) {
            expect(catalogIds.has(id)).toBe(true);
          }
        }
      }
    }
  });

  test("terminal options (nextNodeId=null) have recommends", () => {
    for (const node of DECISION_TREE) {
      for (const opt of node.options) {
        if (opt.nextNodeId === null) {
          expect(opt.recommends).toBeDefined();
          expect(opt.recommends!.length).toBeGreaterThan(0);
        }
      }
    }
  });

  test("all nodes are reachable from root", () => {
    const visited = new Set<string>();
    const nodeMap = new Map(DECISION_TREE.map((n) => [n.id, n]));

    function visit(nodeId: string): void {
      if (visited.has(nodeId)) return;
      visited.add(nodeId);
      const node = nodeMap.get(nodeId);
      if (!node) return;
      for (const opt of node.options) {
        if (opt.nextNodeId !== null) {
          visit(opt.nextNodeId);
        }
      }
    }

    visit("component-model");
    for (const node of DECISION_TREE) {
      expect(visited.has(node.id)).toBe(true);
    }
  });
});

describe("traverseDecisionTree", () => {
  test("React + utility-first + important a11y → shadcn-ui, tailwind-headlessui", () => {
    const ids = traverseDecisionTree({
      "component-model": "react",
      "react-css": "utility-first",
      "react-utility-a11y": "important",
    });
    expect(ids).toEqual(["shadcn-ui", "tailwind-headlessui"]);
  });

  test("React + css-in-js + important + battle-tested → mui", () => {
    const ids = traverseDecisionTree({
      "component-model": "react",
      "react-css": "css-in-js",
      "react-cssjs-a11y": "important",
      "react-cssjs-maturity": "battle-tested",
    });
    expect(ids).toEqual(["mui"]);
  });

  test("Svelte → skeleton-svelte", () => {
    const ids = traverseDecisionTree({
      "component-model": "svelte",
    });
    expect(ids).toEqual(["skeleton-svelte"]);
  });

  test("Angular → angular-material", () => {
    const ids = traverseDecisionTree({
      "component-model": "angular",
    });
    expect(ids).toEqual(["angular-material"]);
  });

  test("agnostic + utility-first + very-sensitive → daisyui, flowbite", () => {
    const ids = traverseDecisionTree({
      "component-model": "agnostic",
      "agnostic-css": "utility-first",
      "agnostic-bundle": "very-sensitive",
    });
    expect(ids).toEqual(["daisyui", "flowbite"]);
  });

  test("returns empty array for incomplete answers", () => {
    const ids = traverseDecisionTree({
      "component-model": "react",
    });
    expect(ids).toEqual([]);
  });

  test("returns empty array for invalid answer value", () => {
    const ids = traverseDecisionTree({
      "component-model": "invalid-framework",
    });
    expect(ids).toEqual([]);
  });

  test("returns empty array for empty answers", () => {
    expect(traverseDecisionTree({})).toEqual([]);
  });
});

describe("getRecommendations", () => {
  test("returns full FrameworkEntry objects", () => {
    const recs = getRecommendations({
      "component-model": "svelte",
    });
    expect(recs.length).toBe(1);
    expect(recs[0].id).toBe("skeleton-svelte");
    expect(recs[0].name).toBe("Skeleton");
  });

  test("returns empty array for incomplete traversal", () => {
    expect(getRecommendations({})).toEqual([]);
  });
});
