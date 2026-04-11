import { describe, test, expect } from "bun:test";
import {
  sanitizeRoute,
  calculateSections,
} from "../../../src/core/design-eval/capture";

describe("sanitizeRoute", () => {
  test("converts / to index", () => {
    expect(sanitizeRoute("/")).toBe("index");
  });

  test("strips leading slash", () => {
    expect(sanitizeRoute("/about")).toBe("about");
  });

  test("replaces slashes with hyphens", () => {
    expect(sanitizeRoute("/foo/bar")).toBe("foo-bar");
  });

  test("replaces multiple slashes", () => {
    expect(sanitizeRoute("/foo/bar/baz")).toBe("foo-bar-baz");
  });

  test("replaces special characters with underscores", () => {
    expect(sanitizeRoute("/hello world!")).toBe("hello_world_");
  });

  test("preserves alphanumeric and hyphens", () => {
    expect(sanitizeRoute("/my-page-123")).toBe("my-page-123");
  });
});

describe("calculateSections", () => {
  test("single section for page smaller than viewport", () => {
    expect(calculateSections(500, 900, 8)).toBe(1);
  });

  test("exact fit requires one section", () => {
    expect(calculateSections(900, 900, 8)).toBe(1);
  });

  test("2700px on 900px viewport = 3 sections", () => {
    expect(calculateSections(2700, 900, 8)).toBe(3);
  });

  test("caps at maxSections", () => {
    expect(calculateSections(10000, 900, 8)).toBe(8);
  });

  test("slightly over one viewport = 2 sections", () => {
    expect(calculateSections(901, 900, 8)).toBe(2);
  });

  test("zero height = 0 sections", () => {
    expect(calculateSections(0, 900, 8)).toBe(0);
  });

  test("negative height = 0 sections", () => {
    expect(calculateSections(-100, 900, 8)).toBe(0);
  });

  test("custom maxSections is respected", () => {
    expect(calculateSections(10000, 900, 3)).toBe(3);
  });
});

describe("file naming convention", () => {
  test("produces correct filenames", () => {
    const prefix = sanitizeRoute("/");
    expect(`${prefix}-desktop-0.jpg`).toBe("index-desktop-0.jpg");
  });

  test("nested route filename", () => {
    const prefix = sanitizeRoute("/foo/bar");
    expect(`${prefix}-mobile-2.jpg`).toBe("foo-bar-mobile-2.jpg");
  });

  test("about page filename", () => {
    const prefix = sanitizeRoute("/about");
    expect(`${prefix}-desktop-0.jpg`).toBe("about-desktop-0.jpg");
  });
});
