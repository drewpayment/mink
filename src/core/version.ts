// Resolve the running Mink version from the nearest package.json, walking up
// from this module's location. Works both from source (src/core/…) and from a
// built bundle (dist/…), since package.json sits above both. Cached after the
// first successful read. Falls back to "0.0.0" if it cannot be determined.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

let cached: string | null = null;

export function minkVersion(): string {
  if (cached !== null) return cached;

  let dir: string;
  try {
    dir = dirname(fileURLToPath(import.meta.url));
  } catch {
    dir = process.cwd();
  }

  for (let i = 0; i < 8; i++) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8"));
      if (pkg && typeof pkg.version === "string") {
        const version: string = pkg.version;
        cached = version;
        return version;
      }
    } catch {
      // not here — keep walking up
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  cached = "0.0.0";
  return cached;
}
