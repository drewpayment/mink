#!/usr/bin/env node
// Dispatch shim copied verbatim to dist/cli.js by scripts/build.mjs.
// Prefers Bun for the faster runtime path; falls back to the Node bundle
// in-process so the cold-start tax is zero on Node-only machines.
// Set MINK_RUNTIME=node to force the Node bundle even when Bun is present.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const bunBundle = join(here, "cli.bun.js");
const nodeBundle = join(here, "cli.node.js");

if (typeof globalThis.Bun !== "undefined") {
  await import(bunBundle);
} else {
  const bunPath = process.env.MINK_RUNTIME === "node" ? null : findOnPath("bun");
  if (bunPath) {
    const r = spawnSync(bunPath, [bunBundle, ...process.argv.slice(2)], { stdio: "inherit" });
    process.exit(r.status ?? 1);
  } else {
    await import(nodeBundle);
  }
}

function findOnPath(name) {
  const sep = process.platform === "win32" ? ";" : ":";
  const exts = process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  for (const dir of (process.env.PATH ?? "").split(sep)) {
    if (!dir) continue;
    for (const ext of exts) {
      const p = join(dir, name + ext);
      if (existsSync(p)) return p;
    }
  }
  return null;
}
