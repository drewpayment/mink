import { statSync, existsSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { execSync } from "child_process";
import { safeReadJson, atomicWriteJson, atomicWriteText } from "../core/fs-utils";
import { isSessionState, buildSummary } from "../core/session";
import { reflect } from "./reflect";
import { createLedgerFinalizer } from "../core/token-ledger";
import { loadBugMemory, hasBugForFileInSession } from "../core/bug-memory";
import { createActionLogWriter, consolidateLog } from "../core/action-log";
import {
  isWikiEnabled,
  isVaultInitialized,
  resolveVaultPath,
  vaultProjects,
} from "../core/vault";
import { resolveConfigValue } from "../core/global-config";
import type { SessionState, SessionFinalizer } from "../types/session";
import type { ProjectConfig } from "../types/file-index";

function hasActivity(state: SessionState): boolean {
  return Object.keys(state.reads).length > 0 || state.writes.length > 0;
}

function getEditCounts(state: SessionState): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const write of state.writes) {
    counts[write.filePath] = (counts[write.filePath] || 0) + 1;
  }
  return counts;
}

function isLearningMemoryStale(memoryPath: string): boolean {
  try {
    const stat = statSync(memoryPath);
    const ageMs = Date.now() - stat.mtimeMs;
    const twentyFourHours = 24 * 60 * 60 * 1000;
    return ageMs > twentyFourHours;
  } catch {
    // File doesn't exist yet — not stale, just absent
    return false;
  }
}

export function sessionStop(
  sessionFile: string,
  finalizer?: SessionFinalizer,
  onReminder: (msg: string) => void = (msg) => console.error(msg)
): void {
  const raw = safeReadJson(sessionFile);
  if (!isSessionState(raw)) {
    if (raw !== null) {
      console.error("[mink] session.json is corrupt — skipping finalization");
    }
    return;
  }

  const state: SessionState = raw;
  state.stopCount++;

  const projDir = dirname(sessionFile);
  const effectiveFinalizer = finalizer ?? createLedgerFinalizer(projDir);

  if (hasActivity(state)) {
    const summary = buildSummary(state);

    if (state.stopCount === 1) {
      effectiveFinalizer.appendSession(summary);
    } else {
      effectiveFinalizer.updateSession(summary);
    }

    // Append session end to action log and run consolidation
    try {
      const logPath = join(projDir, "action-log.md");
      const logWriter = createActionLogWriter(logPath);
      logWriter.appendSessionEnd(summary);

      const cfgRaw = safeReadJson(join(projDir, "config.json")) as ProjectConfig | null;
      consolidateLog(logPath, {
        maxEntries: cfgRaw?.actionLogMaxEntries ?? 200,
        retentionDays: cfgRaw?.actionLogRetentionDays ?? 7,
      });
    } catch {
      // Never crash
    }
  }

  // Check for files edited 3+ times without a corresponding bug entry
  const editCounts = getEditCounts(state);
  const bugMemoryFile = join(projDir, "bug-memory.json");
  const bugMemory = loadBugMemory(bugMemoryFile);

  for (const [filePath, count] of Object.entries(editCounts)) {
    if (count >= 3) {
      const hasBug = hasBugForFileInSession(
        bugMemory,
        filePath,
        state.startTimestamp
      );
      if (!hasBug) {
        onReminder(
          `[mink] ${filePath} was edited ${count} times — consider logging a bug`
        );
      }
    }
  }

  // Run reflection to merge duplicates and prune oversized memory
  const memoryPath = join(projDir, "learning-memory.md");
  const cfgPath = join(projDir, "config.json");
  if (existsSync(memoryPath)) {
    reflect(projDir, memoryPath, cfgPath);
  }

  // Check if learning memory is stale (>24h since last update)
  if (isLearningMemoryStale(memoryPath)) {
    onReminder(
      "[mink] learning memory hasn't been updated in 24+ hours — consider reviewing it"
    );
  }

  // Write session summary to wiki vault
  try {
    if (isWikiEnabled() && isVaultInitialized() && hasActivity(state)) {
      writeSessionToWiki(state, projDir);
    }
  } catch {
    // Never crash hooks
  }

  // Git backup for wiki vault
  try {
    if (isWikiEnabled() && isVaultInitialized()) {
      const gitBackup = resolveConfigValue("wiki.git-backup");
      if (gitBackup.value === "true") {
        gitBackupVault(onReminder);
      }
    }
  } catch {
    // Never crash hooks
  }

  atomicWriteJson(sessionFile, state);
}

function writeSessionToWiki(
  state: SessionState,
  projDir: string
): void {
  const metaRaw = safeReadJson(join(projDir, "project-meta.json")) as Record<
    string,
    unknown
  > | null;
  const projectName = (metaRaw?.name as string) ?? "unknown";

  const date = new Date().toISOString().split("T")[0];
  const readCount = Object.keys(state.reads).length;
  const writeCount = state.writes.length;

  const sessionDir = join(vaultProjects(projectName), "sessions");
  const sessionFile = join(sessionDir, `${date}.md`);

  const timestamp = new Date().toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const entry = [
    ``,
    `### Session ${timestamp}`,
    ``,
    `- Reads: ${readCount}`,
    `- Writes: ${writeCount}`,
  ];

  // Top edited files
  const editCounts: Record<string, number> = {};
  for (const w of state.writes) {
    editCounts[w.filePath] = (editCounts[w.filePath] || 0) + 1;
  }
  const topEdits = Object.entries(editCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  if (topEdits.length > 0) {
    entry.push(`- Key files:`);
    for (const [file, count] of topEdits) {
      entry.push(`  - \`${file}\` (${count} edits)`);
    }
  }

  entry.push("");

  if (existsSync(sessionFile)) {
    const existing = readFileSync(sessionFile, "utf-8");
    atomicWriteText(sessionFile, existing.trimEnd() + "\n" + entry.join("\n"));
  } else {
    const header = [
      `---`,
      `created: "${new Date().toISOString()}"`,
      `updated: "${new Date().toISOString()}"`,
      `tags: [session, ${projectName}]`,
      `category: projects`,
      `---`,
      ``,
      `# Sessions — ${projectName} — ${date}`,
    ].join("\n");
    atomicWriteText(sessionFile, header + "\n" + entry.join("\n"));
  }
}

function gitBackupVault(
  onReminder: (msg: string) => void
): void {
  const vaultPath = resolveVaultPath();

  // Check if vault is a git repo
  const gitDir = join(vaultPath, ".git");
  if (!existsSync(gitDir)) {
    onReminder(
      "[mink] wiki git-backup enabled but vault is not a git repo — run 'git init' in " +
        vaultPath
    );
    return;
  }

  try {
    // Check for changes
    const status = execSync("git status --porcelain", {
      cwd: vaultPath,
      timeout: 5000,
    }).toString();

    if (!status.trim()) return; // Nothing to commit

    // Stage and commit
    execSync("git add -A", { cwd: vaultPath, timeout: 5000 });
    const msg = `mink: vault update ${new Date().toISOString().split("T")[0]}`;
    execSync(`git commit -m "${msg}"`, {
      cwd: vaultPath,
      timeout: 5000,
    });

    // Push (best-effort with timeout)
    const remote = resolveConfigValue("wiki.git-remote").value;
    try {
      execSync(`git push ${remote}`, {
        cwd: vaultPath,
        timeout: 10000,
      });
    } catch {
      onReminder(
        `[mink] wiki git push to '${remote}' failed — local commit preserved, will retry next session`
      );
    }
  } catch (err) {
    onReminder(
      `[mink] wiki git backup error: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
