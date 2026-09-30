import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { readFileSync } from "fs";
import { config as configCommand } from "../../src/commands/config";
import { setConfigValue, resolveConfigValue } from "../../src/core/global-config";
import { globalConfigPath, localConfigPath } from "../../src/core/paths";
import { resolveRerankSettings, RERANK_DEFAULTS } from "../../src/core/recall-ranked";
import {
  CONFIG_KEYS,
  displayConfigValue,
  getConfigKeyMeta,
  isSecretConfigKey,
  maskSecretValue,
} from "../../src/types/config";
import { useMinkFixture } from "../helpers/mink-fixture";

const ENV_KEYS = [
  "JEV_API_KEY",
  ...CONFIG_KEYS.filter((k) => k.key.startsWith("recall.")).map((k) => k.envVar),
  "MINK_CHANNEL_DISCORD_BOT_TOKEN",
];

describe("recall.rerank config keys", () => {
  test("defaults and scopes", () => {
    const expected: Record<string, [string, "shared" | "local"]> = {
      "recall.rerank": ["off", "shared"],
      "recall.rerank-api-key": ["", "local"],
      "recall.rerank-base-url": ["https://api.typesafe.ai", "local"],
      "recall.rerank-model": ["jev-latest", "shared"],
      "recall.rerank-min-relevance": ["0.7", "shared"],
      "recall.rerank-pool-size": ["40", "shared"],
      "recall.rerank-timeout-ms": ["3000", "shared"],
      "recall.rerank-concurrency": ["8", "shared"],
    };
    for (const [key, [def, scope]] of Object.entries(expected)) {
      const meta = CONFIG_KEYS.find((k) => k.key === key)!;
      expect(meta).toBeDefined();
      expect(meta.default).toBe(def);
      expect(meta.scope).toBe(scope);
      expect(meta.envVar).toBe("MINK_" + key.toUpperCase().replace(/[.-]/g, "_"));
    }
  });

  test("only the discord bot token and the rerank API key are secret", () => {
    const secrets = CONFIG_KEYS.filter((k) => k.secret).map((k) => k.key).sort();
    expect(secrets).toEqual(["channel.discord.bot-token", "recall.rerank-api-key"]);
    expect(isSecretConfigKey("recall.rerank-model")).toBe(false);
  });
});

describe("secret masking helpers", () => {
  test("mask shows bullets plus the last 4 characters, or (not set)", () => {
    expect(maskSecretValue("sk-abcdef123456")).toBe("••••3456");
    expect(maskSecretValue("abc")).toBe("••••");
    expect(maskSecretValue("abcd")).toBe("••••");
    expect(maskSecretValue("")).toBe("(not set)");
    expect(maskSecretValue(undefined)).toBe("(not set)");
  });

  test("displayConfigValue masks only secret keys", () => {
    expect(displayConfigValue("recall.rerank-api-key", "sk-abcdef123456")).toBe("••••3456");
    expect(displayConfigValue("channel.discord.bot-token", "")).toBe("(not set)");
    expect(displayConfigValue("recall.rerank-model", "jev-latest")).toBe("jev-latest");
  });
});

describe("resolveRerankSettings", () => {
  const fx = useMinkFixture("mink-rerank-settings");
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  test("defaults", () => {
    expect(fx.current.minkRoot).toBeTruthy();
    expect(resolveRerankSettings()).toEqual({
      mode: "off",
      apiKey: "",
      baseUrl: RERANK_DEFAULTS.baseUrl,
      model: "jev-latest",
      minRelevance: 0.7,
      poolSize: 40,
      timeoutMs: 3000,
      concurrency: 8,
    });
  });

  test("JEV_API_KEY is the fallback for the API key", () => {
    process.env.JEV_API_KEY = "gateway-key-9999";
    expect(resolveRerankSettings().apiKey).toBe("gateway-key-9999");
  });

  test("MINK_RECALL_RERANK_API_KEY beats JEV_API_KEY, and the config file beats JEV_API_KEY", () => {
    process.env.JEV_API_KEY = "gateway-key-9999";
    setConfigValue("recall.rerank-api-key", "from-config-1111");
    expect(resolveRerankSettings().apiKey).toBe("from-config-1111");
    process.env.MINK_RECALL_RERANK_API_KEY = "from-env-2222";
    expect(resolveRerankSettings().apiKey).toBe("from-env-2222");
  });

  test("reads config and env values", () => {
    setConfigValue("recall.rerank", "jev");
    setConfigValue("recall.rerank-model", "jev");
    setConfigValue("recall.rerank-pool-size", "25");
    process.env.MINK_RECALL_RERANK_BASE_URL = "https://ai-gateway.vercel.sh/typesafe";
    process.env.MINK_RECALL_RERANK_MIN_RELEVANCE = "0.7";
    const s = resolveRerankSettings();
    expect(s).toMatchObject({
      mode: "jev",
      model: "jev",
      poolSize: 25,
      baseUrl: "https://ai-gateway.vercel.sh/typesafe",
      minRelevance: 0.7,
    });
  });

  test("invalid or out-of-range numerics resolve to defaults; unknown mode is off", () => {
    setConfigValue("recall.rerank", "banana");
    process.env.MINK_RECALL_RERANK_MIN_RELEVANCE = "abc";
    process.env.MINK_RECALL_RERANK_POOL_SIZE = "0";
    process.env.MINK_RECALL_RERANK_TIMEOUT_MS = "-5";
    process.env.MINK_RECALL_RERANK_CONCURRENCY = "9999";
    const s = resolveRerankSettings();
    expect(s.mode).toBe("off");
    expect(s.minRelevance).toBe(0.7);
    expect(s.poolSize).toBe(40);
    expect(s.timeoutMs).toBe(3000);
    expect(s.concurrency).toBe(8);
    process.env.MINK_RECALL_RERANK_MIN_RELEVANCE = "1.5";
    expect(resolveRerankSettings().minRelevance).toBe(0.7);
    process.env.MINK_RECALL_RERANK_MIN_RELEVANCE = "0";
    expect(resolveRerankSettings().minRelevance).toBe(0);
  });

  test("the API key is stored in the local (unsynced) config, not the shared one", () => {
    setConfigValue("recall.rerank-api-key", "local-only-7777");
    expect(getConfigKeyMeta("recall.rerank-api-key").scope).toBe("local");
    expect(readFileSync(localConfigPath(), "utf-8")).toContain("local-only-7777");
    let shared = "";
    try {
      shared = readFileSync(globalConfigPath(), "utf-8");
    } catch {
      // no shared config file written at all
    }
    expect(shared).not.toContain("local-only-7777");
    expect(resolveConfigValue("recall.rerank-api-key").value).toBe("local-only-7777");
  });
});

describe("mink config — secret masking in every print path", () => {
  const fx = useMinkFixture("mink-config-mask");
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  async function run(args: string[]): Promise<{ out: string; err: string }> {
    const out: string[] = [];
    const err: string[] = [];
    const [log, error] = [console.log, console.error];
    console.log = (...a: unknown[]) => void out.push(a.map(String).join(" "));
    console.error = (...a: unknown[]) => void err.push(a.map(String).join(" "));
    try {
      await configCommand(args);
    } finally {
      console.log = log;
      console.error = error;
    }
    return { out: out.join("\n"), err: err.join("\n") };
  }

  const SECRET = "sk-live-SUPERSECRET-abcd";

  test("set echoes a masked value and never the secret", async () => {
    expect(fx.current.minkRoot).toBeTruthy();
    const { out } = await run(["recall.rerank-api-key", SECRET]);
    expect(out).toContain("recall.rerank-api-key = ••••abcd");
    expect(out).not.toContain("SUPERSECRET");
    // ...but the value really was stored
    expect(resolveConfigValue("recall.rerank-api-key").value).toBe(SECRET);
  });

  test("get one masks the value", async () => {
    setConfigValue("recall.rerank-api-key", SECRET);
    const { out } = await run(["recall.rerank-api-key"]);
    expect(out).toContain("recall.rerank-api-key = ••••abcd");
    expect(out).not.toContain("SUPERSECRET");
  });

  test("get/list show (not set) for an empty secret", async () => {
    expect((await run(["recall.rerank-api-key"])).out).toContain("recall.rerank-api-key = (not set)");
    const list = (await run([])).out;
    expect(list).toContain("channel.discord.bot-token = (not set)");
    expect(list).toContain("recall.rerank-api-key = (not set)");
  });

  test("list masks both secrets and leaves other values alone", async () => {
    setConfigValue("recall.rerank-api-key", SECRET);
    setConfigValue("channel.discord.bot-token", "discord-TOKEN-wxyz");
    const { out } = await run([]);
    expect(out).toContain("recall.rerank-api-key = ••••abcd");
    expect(out).toContain("channel.discord.bot-token = ••••wxyz");
    expect(out).not.toContain("SUPERSECRET");
    expect(out).not.toContain("discord-TOKEN");
    expect(out).toContain("recall.rerank-model = jev-latest");
  });

  test("an env-overridden secret masks both the effective and the config-file value", async () => {
    setConfigValue("recall.rerank-api-key", "file-secret-1234");
    process.env.MINK_RECALL_RERANK_API_KEY = "env-secret-5678";
    const list = (await run([])).out;
    expect(list).toContain("recall.rerank-api-key = ••••5678");
    expect(list).toContain("[config file value: ••••1234 — overridden]");
    expect(list).not.toContain("file-secret");
    expect(list).not.toContain("env-secret");

    const one = (await run(["recall.rerank-api-key"])).out;
    expect(one).toContain("••••5678");
    expect(one).toContain("config file value (••••1234) is overridden");
    expect(one).not.toContain("secret-");
  });
});

describe("mink config set recall.rerank — disclosure", () => {
  const fx = useMinkFixture("mink-config-disclosure");
  async function run(args: string[]): Promise<string> {
    const out: string[] = [];
    const log = console.log;
    console.log = (...a: unknown[]) => void out.push(a.map(String).join(" "));
    try {
      await configCommand(args);
    } finally {
      console.log = log;
    }
    return out.join("\n");
  }
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  test("enabling prints what is sent, where, and how to turn it off", async () => {
    expect(fx.current.minkRoot).toBeTruthy();
    const out = await run(["recall.rerank", "jev"]);
    expect(out).toContain("recall.rerank = jev");
    expect(out).toContain("titles, tags, paths and excerpts");
    expect(out).toContain("up to 40 candidate notes per query");
    expect(out).toContain("https://api.typesafe.ai");
    expect(out).toContain("mink config recall.rerank off");
  });

  test("the notice names the resolved (gateway) base URL and pool size", async () => {
    setConfigValue("recall.rerank-base-url", "https://ai-gateway.vercel.sh/typesafe");
    setConfigValue("recall.rerank-pool-size", "25");
    const out = await run(["recall.rerank", "jev"]);
    expect(out).toContain("up to 25 candidate notes per query to https://ai-gateway.vercel.sh/typesafe");
  });

  test("`config set <key> <value>` and `config get <key>` work as aliases", async () => {
    const out = await run(["set", "recall.rerank", "jev"]);
    expect(out).toContain("recall.rerank = jev");
    expect(out).toContain("titles, tags, paths and excerpts");
    expect(resolveConfigValue("recall.rerank").value).toBe("jev");
    expect(await run(["get", "recall.rerank"])).toContain("recall.rerank = jev (source: config file)");
    await run(["set", "recall.rerank", "off"]);
    expect(resolveConfigValue("recall.rerank").value).toBe("off");
  });

  test("setting off (or another key) prints no notice", async () => {
    expect(await run(["recall.rerank", "off"])).not.toContain("notice");
    expect(await run(["recall.rerank-model", "jev"])).not.toContain("notice");
  });
});
