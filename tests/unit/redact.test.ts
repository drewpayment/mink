import { describe, expect, test, afterEach } from "bun:test";
import { redactForStorage, redactSecrets } from "../../src/core/redact";

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
// A generic ≥12-char secret value that matches no provider-specific rule, so
// only the assignment rule catches it.
const ASSIGN_VALUE = "abcdef0123456789ABCDEF";

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

  test("email (PII)", () => {
    const r = redactSecrets("ping alice@example.com about it");
    expect(r.text).toContain("[REDACTED:email]");
    expect(r.text).not.toContain("alice@example.com");
  });

  test("Stripe secret key", () => {
    const r = redactSecrets("sk_" + "live_" + "a".repeat(24));
    expect(r.text).toContain("[REDACTED:stripe-key]");
  });

  test("OpenAI key", () => {
    const r = redactSecrets("sk-" + "a".repeat(28));
    expect(r.text).toContain("[REDACTED:openai-key]");
  });

  test("npm token", () => {
    const r = redactSecrets("npm_" + "a".repeat(36));
    expect(r.text).toContain("[REDACTED:npm-token]");
  });

  test("Google OAuth token", () => {
    const r = redactSecrets("ya29." + "a".repeat(40));
    expect(r.text).toContain("[REDACTED:google-oauth]");
  });
});

describe("redactSecrets — allowlist + no false positives", () => {
  test("an allowlisted value is not masked", () => {
    const email = "release-bot@example.com";
    const r = redactSecrets(`from ${email}`, { allowlist: new Set([email]) });
    expect(r.text).toContain(email);
    expect(r.redactions).toBe(0);
  });

  test("a 40-char git SHA is NOT masked", () => {
    const sha = "a".repeat(40); // hex-like commit hash
    const r = redactSecrets(`see commit ${sha}`);
    expect(r.text).toContain(sha);
    expect(r.redactions).toBe(0);
  });
});

describe("redactForStorage — config-aware", () => {
  afterEach(() => {
    delete process.env.MINK_REDACTION_ENABLED;
    delete process.env.MINK_REDACTION_ALLOWLIST;
  });

  test("redacts by default (enabled)", () => {
    const r = redactForStorage("key " + "AKIA" + "IOSFODNN7EXAMPLE" + " here");
    expect(r.text).toContain("[REDACTED:aws-access-key]");
  });

  test("passes through unchanged when disabled", () => {
    process.env.MINK_REDACTION_ENABLED = "false";
    const input = "key " + "AKIA" + "IOSFODNN7EXAMPLE" + " here";
    const r = redactForStorage(input);
    expect(r.text).toBe(input);
    expect(r.redactions).toBe(0);
  });

  test("honors the configured allowlist", () => {
    process.env.MINK_REDACTION_ALLOWLIST = "keep@example.com";
    const r = redactForStorage("mail keep@example.com and drop@evil.com");
    expect(r.text).toContain("keep@example.com");
    expect(r.text).toContain("[REDACTED:email]"); // drop@ still masked
    expect(r.text).not.toContain("drop@evil.com");
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
