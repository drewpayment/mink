import { describe, expect, test } from "bun:test";
import { isWriteExcluded } from "../../src/core/write-exclusions";

describe("isWriteExcluded", () => {
  test(".env is excluded", () => {
    expect(isWriteExcluded(".env")).toBe(true);
  });

  test(".env.local is excluded", () => {
    expect(isWriteExcluded(".env.local")).toBe(true);
  });

  test(".env.production is excluded", () => {
    expect(isWriteExcluded(".env.production")).toBe(true);
  });

  test(".env in subdirectory is excluded", () => {
    expect(isWriteExcluded("config/.env")).toBe(true);
  });

  test(".mink/session.json is excluded", () => {
    expect(isWriteExcluded(".mink/session.json")).toBe(true);
  });

  test(".mink/file-index.json is excluded", () => {
    expect(isWriteExcluded(".mink/file-index.json")).toBe(true);
  });

  test(".mink itself is excluded", () => {
    expect(isWriteExcluded(".mink")).toBe(true);
  });

  test("src/app.ts is not excluded", () => {
    expect(isWriteExcluded("src/app.ts")).toBe(false);
  });

  test("src/.env-utils.ts is not excluded (not an actual .env file)", () => {
    expect(isWriteExcluded("src/.env-utils.ts")).toBe(false);
  });

  test(".minkish/something.ts is not excluded", () => {
    expect(isWriteExcluded(".minkish/something.ts")).toBe(false);
  });

  test("package.json is not excluded", () => {
    expect(isWriteExcluded("package.json")).toBe(false);
  });
});
