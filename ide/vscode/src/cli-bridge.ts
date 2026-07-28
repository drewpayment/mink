// Pure CLI-bridge logic for the Mink VS Code extension (spec 31). The extension
// is a THIN client: it never reimplements Mink logic, it invokes the `mink` CLI
// and renders the output. This module builds the argv for each action and has no
// dependency on the VS Code API, so it is unit-testable in isolation.

export type MinkAction = "context" | "bug-search" | "similar" | "note";

export interface MinkCommand {
  /** Argv passed to the `mink` binary. */
  args: string[];
  /** Short human title for the output channel / progress. */
  title: string;
}

/**
 * Build the `mink` invocation for an action. Throws on missing required input so
 * the extension can surface a clear message instead of running a malformed call.
 */
export function buildMinkCommand(action: MinkAction, input?: string): MinkCommand {
  switch (action) {
    case "context":
      return { args: ["context"], title: "Mink: Context Pack" };
    case "bug-search": {
      const q = (input ?? "").trim();
      if (!q) throw new Error("a search query is required");
      return { args: ["bug", "search", q], title: `Mink: Bugs for “${q}”` };
    }
    case "similar": {
      const file = (input ?? "").trim();
      if (!file) throw new Error("a file path is required");
      return { args: ["similar", `--files=${file}`], title: "Mink: Similar Tasks" };
    }
    case "note": {
      const text = (input ?? "").trim();
      if (!text) throw new Error("note text is required");
      return { args: ["note", text], title: "Mink: Capture Note" };
    }
    default: {
      // Exhaustiveness guard — a new action must be handled above.
      const never: never = action;
      throw new Error(`unknown Mink action: ${String(never)}`);
    }
  }
}

/** Resolve the workspace-relative path VS Code should pass to `mink similar`. */
export function relativePathFor(workspaceRoot: string, filePath: string): string {
  const root = workspaceRoot.replace(/\/+$/, "");
  if (filePath === root) return "";
  return filePath.startsWith(root + "/") ? filePath.slice(root.length + 1) : filePath;
}
