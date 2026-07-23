import { describe, test, expect } from "bun:test";
import { parseRecallArgs } from "../../../src/commands/recall";

// The agent template and mink-note skill invoke this as
// `mink recall --json "<query>"` — flags BEFORE the positional query — so
// arg parsing must accept flags in any position relative to the query, not
// just after it.
describe("parseRecallArgs — flag/positional ordering", () => {
  test("--json before the query (agent/skill invocation shape)", () => {
    const parsed = parseRecallArgs(["--json", "exponential backoff"]);
    expect(parsed.json).toBe(true);
    expect(parsed.query).toBe("exponential backoff");
  });

  test("--json after the query", () => {
    const parsed = parseRecallArgs(["exponential backoff", "--json"]);
    expect(parsed.json).toBe(true);
    expect(parsed.query).toBe("exponential backoff");
  });

  test("multiple flags interleaved before, between, and after the query tokens", () => {
    const parsed = parseRecallArgs([
      "--json",
      "--limit",
      "5",
      "exponential",
      "--tag",
      "infra",
      "backoff",
      "--category",
      "inbox",
    ]);
    expect(parsed.json).toBe(true);
    expect(parsed.limit).toBe(5);
    expect(parsed.tag).toBe("infra");
    expect(parsed.category).toBe("inbox");
    // Positional tokens are joined in the order they appear, wherever they
    // fall relative to the flags.
    expect(parsed.query).toBe("exponential backoff");
  });

  test("all filters recognized regardless of position", () => {
    const parsed = parseRecallArgs([
      "--project",
      "mink",
      "--since",
      "2026-01-01",
      "some query text",
    ]);
    expect(parsed.project).toBe("mink");
    expect(parsed.since).toBe("2026-01-01");
    expect(parsed.query).toBe("some query text");
  });

  test("no flags — plain positional query", () => {
    const parsed = parseRecallArgs(["plain", "query"]);
    expect(parsed.json).toBe(false);
    expect(parsed.limit).toBe(10);
    expect(parsed.query).toBe("plain query");
  });

  test("no positional args — empty query", () => {
    const parsed = parseRecallArgs(["--json"]);
    expect(parsed.query).toBe("");
  });
});
