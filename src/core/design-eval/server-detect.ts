import { readFileSync } from "fs";
import { join } from "path";
import type { Subprocess } from "bun";
import { DEFAULT_PROBE_PORTS } from "../../types/design-eval";

/**
 * Check if a port is responding to HTTP requests.
 */
export async function probePort(port: number): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    await fetch(`http://localhost:${port}`, { signal: controller.signal });
    clearTimeout(timeout);
    return true;
  } catch {
    return false;
  }
}

/**
 * Probe common dev server ports and return the first responding URL.
 */
export async function findRunningServer(
  ports: number[] = DEFAULT_PROBE_PORTS
): Promise<string | null> {
  for (const port of ports) {
    if (await probePort(port)) {
      return `http://localhost:${port}`;
    }
  }
  return null;
}

/**
 * Read package.json scripts to find a likely dev server command.
 * Checks for "dev", "start", "serve" in that priority order.
 */
export function detectDevCommand(cwd: string): string | null {
  try {
    const raw = readFileSync(join(cwd, "package.json"), "utf-8");
    const pkg = JSON.parse(raw);
    const scripts = pkg.scripts;
    if (!scripts || typeof scripts !== "object") return null;

    for (const key of ["dev", "start", "serve"]) {
      if (typeof scripts[key] === "string") {
        // Return the npm/bun run command, not the raw script value
        return `npm run ${key}`;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Start a dev server and wait for it to become responsive.
 * Returns the server URL and the spawned process.
 */
export async function startAndWaitForServer(
  cwd: string,
  command: string,
  timeoutMs: number = 30000
): Promise<{ url: string; proc: Subprocess }> {
  const parts = command.split(/\s+/);
  const proc = Bun.spawn(parts, {
    cwd,
    stdout: "ignore",
    stderr: "ignore",
    stdin: "ignore",
  });

  const start = Date.now();
  const ports = DEFAULT_PROBE_PORTS;

  while (Date.now() - start < timeoutMs) {
    for (const port of ports) {
      if (await probePort(port)) {
        return { url: `http://localhost:${port}`, proc };
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  proc.kill();
  throw new Error(
    `[mink] Dev server did not respond within ${Math.round(timeoutMs / 1000)}s. Start it manually and retry.`
  );
}
