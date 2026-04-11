export interface ActionLogEntry {
  time: string; // HH:MM (UTC)
  action: "Session start" | "Read" | "Create" | "Edit" | "Session end";
  files: string; // Truncated file path or "—"
  outcome: string; // index hit/miss, description, or summary
  tokens: string; // "~NNN" or "—"
}

export interface ConsolidationConfig {
  maxEntries: number; // default 200
  retentionDays: number; // default 7
}

export interface ParsedSession {
  startIndex: number; // char offset of session header
  endIndex: number; // char offset of end of session (before next header or EOF)
  date: string; // parsed date from session header (YYYY-MM-DD)
  entryCount: number; // number of table data rows
  content: string; // full text of this session block
}
