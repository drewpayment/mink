const API_KEY_ENV_VARS = [
  "ANTHROPIC_API_KEY",
  "CLAUDE_API_KEY",
  "OPENAI_API_KEY",
  "OPENAI_KEY",
  "AI_API_KEY",
];

export async function executeAiCli(
  prompt: string,
  timeoutMs: number
): Promise<string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !API_KEY_ENV_VARS.includes(key)) {
      env[key] = value;
    }
  }

  const proc = Bun.spawn(["claude", "--print", prompt], {
    env,
    stdout: "pipe",
    stderr: "pipe",
  });

  const timer = setTimeout(() => {
    proc.kill();
  }, timeoutMs);

  try {
    const exitCode = await proc.exited;
    clearTimeout(timer);

    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(`AI CLI exited with code ${exitCode}: ${stderr}`);
    }

    return await new Response(proc.stdout).text();
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof Error && err.message.includes("ENOENT")) {
      throw new Error(
        "AI CLI (claude) is not available. Install it or ensure it is on PATH."
      );
    }
    throw err;
  }
}

/**
 * Extract a JSON object/array from raw model output. Tolerates surrounding
 * prose and fenced code blocks. Returns null on failure.
 */
export function safeJsonExtract<T = unknown>(raw: string): T | null {
  if (!raw) return null;

  const trimmed = raw.trim();

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;

  try {
    return JSON.parse(candidate) as T;
  } catch {
    // Fall through to bracket scan.
  }

  const firstBrace = candidate.search(/[{[]/);
  if (firstBrace === -1) return null;
  const open = candidate[firstBrace];
  const close = open === "{" ? "}" : "]";

  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = firstBrace; i < candidate.length; i++) {
    const ch = candidate[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) {
        const slice = candidate.slice(firstBrace, i + 1);
        try {
          return JSON.parse(slice) as T;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}
