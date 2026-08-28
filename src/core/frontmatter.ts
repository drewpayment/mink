// Minimal YAML frontmatter parser shared by the dashboard note viewer and the
// wiki search indexer. Supports `key: value` and `key: [a, b]` — good enough
// for the note frontmatter Mink itself generates (see note-writer.ts).
// Extracted from dashboard-api.ts so both call sites parse frontmatter
// identically instead of drifting.

export function parseFrontmatter(
  content: string
): { frontmatter: Record<string, unknown>; body: string } {
  if (!content.startsWith("---")) return { frontmatter: {}, body: content };
  const end = content.indexOf("\n---", 3);
  if (end === -1) return { frontmatter: {}, body: content };
  const raw = content.slice(3, end).trim();
  const body = content.slice(end + 4).replace(/^\n/, "");
  const frontmatter: Record<string, unknown> = {};
  for (const rawLine of raw.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const valRaw = line.slice(colonIdx + 1).trim();
    if (valRaw.startsWith("[") && valRaw.endsWith("]")) {
      frontmatter[key] = parseFlowSequence(valRaw.slice(1, -1));
    } else {
      frontmatter[key] = unquoteScalar(valRaw);
    }
  }
  return { frontmatter, body };
}

// Splits a flow sequence body on the commas that sit *outside* quotes. A plain
// split(",") tears quoted values apart, and note-writer quotes any alias
// holding a comma or colon — so `aliases: ["Auth, Sessions and Tokens"]` came
// back as two entries, losing the real alias and minting a spurious short one.
// That defeats the whole point of write-time alias hygiene: the [[wikilink]]
// still wouldn't resolve inside Mink even though Obsidian reads the file fine.
function parseFlowSequence(inner: string): string[] {
  const items: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];

    if (quote === '"') {
      // Double-quoted YAML uses backslash escapes (what JSON.stringify emits),
      // so a `\"` is content, not the closing quote.
      if (ch === "\\" && i + 1 < inner.length) {
        current += ch + inner[++i];
        continue;
      }
      if (ch === '"') quote = null;
      current += ch;
      continue;
    }

    if (quote === "'") {
      // Single-quoted YAML escapes a quote by doubling it instead.
      if (ch === "'" && inner[i + 1] === "'") {
        current += "''";
        i++;
        continue;
      }
      if (ch === "'") quote = null;
      current += ch;
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }

    if (ch === ",") {
      items.push(current);
      current = "";
      continue;
    }

    current += ch;
  }
  items.push(current);

  return items.map(unquoteScalar).filter(Boolean);
}

function unquoteScalar(raw: string): string {
  const value = raw.trim();

  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    // note-writer quotes with JSON.stringify, so JSON.parse is its exact
    // inverse. Fall through to the lenient strip if the escapes are malformed
    // (hand-edited notes) rather than dropping the value.
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed === "string") return parsed;
    } catch {
      // fall through
    }
  }

  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'");
  }

  return value.replace(/^["']|["']$/g, "");
}
