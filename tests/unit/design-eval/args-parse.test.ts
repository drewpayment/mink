import { describe, test, expect } from "bun:test";
import { parseDesignQcArgs } from "../../../src/commands/designqc";

describe("parseDesignQcArgs", () => {
  test("returns defaults with empty args", () => {
    const opts = parseDesignQcArgs([]);
    expect(opts.quality).toBe(70);
    expect(opts.desktopOnly).toBe(false);
    expect(opts.maxSections).toBe(8);
    expect(opts.url).toBeUndefined();
    expect(opts.routes).toBeUndefined();
  });

  test("parses --url", () => {
    const opts = parseDesignQcArgs(["--url", "http://localhost:3000/dashboard"]);
    expect(opts.url).toBe("http://localhost:3000/dashboard");
  });

  test("parses --routes with multiple paths", () => {
    const opts = parseDesignQcArgs(["--routes", "/", "/about", "/contact"]);
    expect(opts.routes).toEqual(["/", "/about", "/contact"]);
  });

  test("--routes stops at next flag", () => {
    const opts = parseDesignQcArgs([
      "--routes",
      "/",
      "/about",
      "--desktop-only",
    ]);
    expect(opts.routes).toEqual(["/", "/about"]);
    expect(opts.desktopOnly).toBe(true);
  });

  test("parses --quality", () => {
    const opts = parseDesignQcArgs(["--quality", "50"]);
    expect(opts.quality).toBe(50);
  });

  test("clamps --quality to 1-100", () => {
    expect(parseDesignQcArgs(["--quality", "0"]).quality).toBe(1);
    expect(parseDesignQcArgs(["--quality", "150"]).quality).toBe(100);
  });

  test("parses --desktop-only", () => {
    const opts = parseDesignQcArgs(["--desktop-only"]);
    expect(opts.desktopOnly).toBe(true);
  });

  test("parses --max-sections", () => {
    const opts = parseDesignQcArgs(["--max-sections", "4"]);
    expect(opts.maxSections).toBe(4);
  });

  test("handles all flags combined", () => {
    const opts = parseDesignQcArgs([
      "--url",
      "http://localhost:3000",
      "--quality",
      "85",
      "--desktop-only",
      "--max-sections",
      "5",
    ]);
    expect(opts.url).toBe("http://localhost:3000");
    expect(opts.quality).toBe(85);
    expect(opts.desktopOnly).toBe(true);
    expect(opts.maxSections).toBe(5);
  });
});
