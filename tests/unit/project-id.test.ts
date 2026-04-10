import { describe, expect, test } from "bun:test";
import { generateProjectId } from "../../src/core/project-id";

describe("generateProjectId", () => {
  test("returns slugified basename with hash suffix", () => {
    const id = generateProjectId("/Users/drew/dev/my-project");
    // Format: <slug>-<6 hex chars>
    expect(id).toMatch(/^my-project-[a-f0-9]{6}$/);
  });

  test("is deterministic for the same path", () => {
    const a = generateProjectId("/Users/drew/dev/my-project");
    const b = generateProjectId("/Users/drew/dev/my-project");
    expect(a).toBe(b);
  });

  test("produces different IDs for same basename in different directories", () => {
    const a = generateProjectId("/Users/drew/dev/my-project");
    const b = generateProjectId("/Users/drew/work/my-project");
    expect(a).not.toBe(b);
  });

  test("handles uppercase and special characters in basename", () => {
    const id = generateProjectId("/Users/drew/dev/My Cool_Project!");
    expect(id).toMatch(/^my-cool-project-[a-f0-9]{6}$/);
  });

  test("handles trailing slashes", () => {
    const a = generateProjectId("/Users/drew/dev/my-project");
    const b = generateProjectId("/Users/drew/dev/my-project/");
    expect(a).toBe(b);
  });
});
