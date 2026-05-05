import { describe, test, expect } from "bun:test";
import { compareSemver, parseSemver } from "../../src/core/self-update";

describe("parseSemver", () => {
  test("parses simple x.y.z", () => {
    expect(parseSemver("1.2.3")).toEqual({ numbers: [1, 2, 3], prerelease: null });
  });

  test("strips a leading v", () => {
    expect(parseSemver("v0.9.1")).toEqual({ numbers: [0, 9, 1], prerelease: null });
  });

  test("captures prerelease tag", () => {
    expect(parseSemver("1.0.0-rc.2")).toEqual({
      numbers: [1, 0, 0],
      prerelease: "rc.2",
    });
  });

  test("returns null for empty input", () => {
    expect(parseSemver("")).toBeNull();
    expect(parseSemver("   ")).toBeNull();
  });

  test("returns null for non-numeric input", () => {
    expect(parseSemver("not-a-version")).toBeNull();
  });
});

describe("compareSemver", () => {
  test("orders by major", () => {
    expect(compareSemver("2.0.0", "1.99.99")).toBe(1);
    expect(compareSemver("1.0.0", "2.0.0")).toBe(-1);
  });

  test("orders by minor when major matches", () => {
    expect(compareSemver("0.10.0", "0.9.1")).toBe(1);
    expect(compareSemver("0.9.1", "0.10.0")).toBe(-1);
  });

  test("orders by patch when major.minor match", () => {
    expect(compareSemver("0.9.2", "0.9.1")).toBe(1);
    expect(compareSemver("0.9.1", "0.9.2")).toBe(-1);
  });

  test("equal versions return 0", () => {
    expect(compareSemver("1.2.3", "1.2.3")).toBe(0);
    expect(compareSemver("v1.2.3", "1.2.3")).toBe(0);
  });

  test("treats missing components as zero", () => {
    expect(compareSemver("1.2", "1.2.0")).toBe(0);
    expect(compareSemver("1.2.0.4", "1.2.0")).toBe(1);
  });

  test("prerelease is older than the same release", () => {
    expect(compareSemver("1.0.0-rc.1", "1.0.0")).toBe(-1);
    expect(compareSemver("1.0.0", "1.0.0-rc.1")).toBe(1);
  });

  test("prereleases compare lexicographically", () => {
    expect(compareSemver("1.0.0-rc.2", "1.0.0-rc.1")).toBe(1);
    expect(compareSemver("1.0.0-alpha", "1.0.0-beta")).toBe(-1);
  });
});
