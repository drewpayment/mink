import { describe, expect, test } from "bun:test";
import { normalizeRemoteUrl } from "../../src/core/git-identity";

describe("normalizeRemoteUrl", () => {
  test("collapses SSH and HTTPS forms of the same remote", () => {
    const ssh = normalizeRemoteUrl("git@github.com:owner/repo.git");
    const https = normalizeRemoteUrl("https://github.com/owner/repo.git");
    expect(ssh).toBe(https);
    expect(ssh).toBe("github.com/owner/repo");
  });

  test("strips embedded credentials", () => {
    const withCreds = normalizeRemoteUrl(
      "https://user:tok@github.com/owner/repo.git"
    );
    const plain = normalizeRemoteUrl("https://github.com/owner/repo.git");
    expect(withCreds).toBe(plain);
  });

  test("ignores trailing slash and .git suffix", () => {
    expect(normalizeRemoteUrl("https://github.com/owner/repo/")).toBe(
      "github.com/owner/repo"
    );
    expect(normalizeRemoteUrl("https://github.com/owner/repo")).toBe(
      "github.com/owner/repo"
    );
    expect(normalizeRemoteUrl("https://github.com/owner/repo.git")).toBe(
      "github.com/owner/repo"
    );
  });

  test("lowercases the entire path so case-only differences unify", () => {
    expect(normalizeRemoteUrl("git@GitHub.com:Owner/Repo.git")).toBe(
      "github.com/owner/repo"
    );
  });

  test("handles ssh:// scheme", () => {
    expect(normalizeRemoteUrl("ssh://git@github.com/owner/repo")).toBe(
      "github.com/owner/repo"
    );
  });

  test("rejects file:// and relative paths so they fall back to path-derived", () => {
    expect(normalizeRemoteUrl("file:///tmp/repo")).toBe("");
    expect(normalizeRemoteUrl("../sibling-repo")).toBe("");
    expect(normalizeRemoteUrl("/absolute/path")).toBe("");
  });

  test("handles self-hosted forges without choking", () => {
    expect(normalizeRemoteUrl("git@git.example.com:team/svc.git")).toBe(
      "git.example.com/team/svc"
    );
  });
});
