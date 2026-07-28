import { describe, expect, test } from "bun:test";
import { redactSecrets } from "../../src/core/redact";

// Sample "secrets" are assembled from fragments at runtime so that no full
// secret literal is ever committed to the repository — otherwise platform
// secret-scanning (push protection) would flag these fixtures. The redactor
// still sees the fully-assembled string, which is what we are testing.
const AWS = "AKIA" + "IOSFODNN7EXAMPLE";
const GCP = "AI" + "za" + "b".repeat(35);
const GH = "gh" + "p_" + "a".repeat(36);
const SLACK = "xo" + "xb" + "-123456789012-abcdefghijklmnop";
const JWT = "ey" + "JhbGciOiJIUzI1NiIs" + "." + "eyJzdWIiOiIxMjM0NTY3ODkw" + "." + "SflKxwRJSMeKKF2QT4";
const PRIVKEY =
  "-----BEGIN RSA PRIVATE KEY-----\n" + "MIIabc123\nlines\n" + "-----END RSA PRIVATE KEY-----";
const BEARER_VALUE = "abcdefghijklmnopqrstuvwxyz012345";
const ASSIGN_VALUE = "sk_" + "live_0123456789abcdef";

describe("redactSecrets — masks high-confidence secrets", () => {
  test("AWS access key id", () => {
    const r = redactSecrets(`key is ${AWS} done`);
    expect(r.text).not.toContain(AWS);
    expect(r.text).toContain("[REDACTED:aws-access-key]");
    expect(r.redactions).toBe(1);
  });

  test("Google API key", () => {
    const r = redactSecrets(GCP);
    expect(r.text).toContain("[REDACTED:gcp-api-key]");
    expect(r.redactions).toBe(1);
  });

  test("GitHub token", () => {
    const r = redactSecrets(GH);
    expect(r.text).toContain("[REDACTED:github-token]");
  });

  test("Slack token", () => {
    const r = redactSecrets(SLACK);
    expect(r.text).toContain("[REDACTED:slack-token]");
    expect(r.text).not.toContain(SLACK);
  });

  test("JWT", () => {
    const r = redactSecrets(`token=${JWT}`);
    expect(r.text).toContain("[REDACTED");
    expect(r.text).not.toContain("SflKxwRJSMeKKF2QT4");
  });

  test("private key block", () => {
    const r = redactSecrets(`here:\n${PRIVKEY}\nafter`);
    expect(r.text).toContain("[REDACTED:private-key]");
    expect(r.text).toContain("after");
    expect(r.text).not.toContain("MIIabc123");
  });

  test("private key without an END footer is still masked (bounded by a blank line)", () => {
    const truncated =
      "-----BEGIN RSA PRIVATE KEY-----\n" + "MIIabc123\nmorelines\n" + "\ntrailing prose";
    const r = redactSecrets(truncated);
    expect(r.text).toContain("[REDACTED:private-key]");
    expect(r.text).not.toContain("MIIabc123");
    expect(r.text).toContain("trailing prose");
  });

  test("bearer token keeps the word Bearer, masks the value", () => {
    const r = redactSecrets(`Authorization: Bearer ${BEARER_VALUE}`);
    expect(r.text).toContain("Bearer");
    expect(r.text).toContain("[REDACTED:bearer]");
    expect(r.text).not.toContain(BEARER_VALUE);
  });

  test("assignment masks the value, keeps the key", () => {
    const r = redactSecrets(`api_key = "${ASSIGN_VALUE}"`);
    expect(r.text).toContain("api_key");
    expect(r.text).toContain("[REDACTED:assignment]");
    expect(r.text).not.toContain(ASSIGN_VALUE);
  });

  test("counts multiple distinct secrets", () => {
    const r = redactSecrets(`${AWS} and ${"AKIA" + "IOSFODNN7EXAMPLB"}`);
    expect(r.redactions).toBe(2);
  });
});

describe("redactSecrets — no false positives on benign content", () => {
  test("ordinary prose is untouched", () => {
    const prose = "The quick brown fox jumps over the lazy dog near the API gateway.";
    const r = redactSecrets(prose);
    expect(r.text).toBe(prose);
    expect(r.redactions).toBe(0);
  });

  test("short assignment values are left alone", () => {
    const r = redactSecrets("password = short"); // < 12 chars
    expect(r.redactions).toBe(0);
    expect(r.text).toContain("short");
  });

  test("empty string is safe", () => {
    const r = redactSecrets("");
    expect(r).toEqual({ text: "", redactions: 0 });
  });

  test("is deterministic", () => {
    const input = `token: abcdefghijklmnopqrstuv and ${AWS}`;
    expect(redactSecrets(input)).toEqual(redactSecrets(input));
  });
});
