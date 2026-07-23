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
      frontmatter[key] = valRaw
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
    } else {
      frontmatter[key] = valRaw.replace(/^["']|["']$/g, "");
    }
  }
  return { frontmatter, body };
}
