import { describe, test, expect } from "bun:test";
import {
  FRAMEWORK_CATALOG,
  getFrameworkById,
} from "../../../src/core/framework-advisor/catalog";
import type { FrameworkEntry } from "../../../src/types/framework-advisor";

describe("FRAMEWORK_CATALOG", () => {
  test("contains at least 12 frameworks", () => {
    expect(FRAMEWORK_CATALOG.length).toBeGreaterThanOrEqual(12);
  });

  test("has no duplicate IDs", () => {
    const ids = FRAMEWORK_CATALOG.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("every framework has all required string fields populated", () => {
    const stringFields: (keyof FrameworkEntry)[] = [
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

    for (const fw of FRAMEWORK_CATALOG) {
      for (const field of stringFields) {
        const val = fw[field];
        expect(typeof val).toBe("string");
        expect((val as string).trim()).not.toBe("");
      }
    }
  });

  test("every framework has bestFor entries", () => {
    for (const fw of FRAMEWORK_CATALOG) {
      expect(fw.bestFor.length).toBeGreaterThan(0);
    }
  });

  test("every framework has limitations entries", () => {
    for (const fw of FRAMEWORK_CATALOG) {
      expect(fw.limitations.length).toBeGreaterThan(0);
    }
  });

  test("darkModeSupport is a boolean for all", () => {
    for (const fw of FRAMEWORK_CATALOG) {
      expect(typeof fw.darkModeSupport).toBe("boolean");
    }
  });

  test("designTokens is a boolean for all", () => {
    for (const fw of FRAMEWORK_CATALOG) {
      expect(typeof fw.designTokens).toBe("boolean");
    }
  });
});

describe("getFrameworkById", () => {
  test("returns the correct framework", () => {
    const fw = getFrameworkById("shadcn-ui");
    expect(fw).toBeDefined();
    expect(fw!.name).toBe("shadcn/ui");
  });

  test("returns undefined for unknown ID", () => {
    expect(getFrameworkById("nonexistent")).toBeUndefined();
  });
});
