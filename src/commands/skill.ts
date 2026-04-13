import { join, resolve, dirname } from "path";
import { homedir } from "os";
import {
  existsSync,
  mkdirSync,
  copyFileSync,
  unlinkSync,
  readdirSync,
  rmSync,
  symlinkSync,
  lstatSync,
} from "fs";

// Standard skills directory used by the skills CLI ecosystem
const AGENTS_SKILLS_DIR = join(homedir(), ".agents", "skills");
// Claude Code looks for skills via symlinks here
const CLAUDE_SKILLS_DIR = join(homedir(), ".claude", "skills");

function getSkillsSourceDir(): string {
  // Skills live at repo-root/skills/ (the standard skills/{name}/SKILL.md layout)
  return resolve(
    dirname(new URL(import.meta.url).pathname),
    "../../skills"
  );
}

function getAvailableSkills(): string[] {
  const dir = getSkillsSourceDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter(
      (d) => d.isDirectory() && existsSync(join(dir, d.name, "SKILL.md"))
    )
    .map((d) => d.name);
}

function isInstalled(skillName: string): boolean {
  return existsSync(join(AGENTS_SKILLS_DIR, skillName, "SKILL.md"));
}

export async function skill(args: string[]): Promise<void> {
  const sub = args[0];

  switch (sub) {
    case "install":
      skillInstall(args[1]);
      break;
    case "uninstall":
      skillUninstall(args[1]);
      break;
    case "list":
      skillList();
      break;
    default:
      console.log("Usage: mink skill <install|uninstall|list> [name]");
      console.log();
      console.log("  install [name]    Install Mink skills to ~/.agents/skills/");
      console.log("  uninstall [name]  Remove installed Mink skills");
      console.log("  list              Show available and installed skills");
      console.log();
      console.log("Or install via the skills CLI:");
      console.log("  npx skills add drewpayment/mink");
      break;
  }
}

function skillInstall(name?: string): void {
  const sourceDir = getSkillsSourceDir();
  const skills = name ? [name] : getAvailableSkills();

  if (skills.length === 0) {
    console.error("[mink] no skills found to install");
    console.error("  Expected skills at: " + sourceDir);
    return;
  }

  mkdirSync(AGENTS_SKILLS_DIR, { recursive: true });

  for (const skillName of skills) {
    const srcDir = join(sourceDir, skillName);
    const srcFile = join(srcDir, "SKILL.md");
    const destDir = join(AGENTS_SKILLS_DIR, skillName);

    if (!existsSync(srcFile)) {
      console.error(`[mink] skill not found: ${skillName}`);
      continue;
    }

    // Copy the entire skill directory (SKILL.md + any reference files)
    mkdirSync(destDir, { recursive: true });
    copyDirRecursive(srcDir, destDir);

    // Create symlink in ~/.claude/skills/ (how Claude Code discovers skills)
    mkdirSync(CLAUDE_SKILLS_DIR, { recursive: true });
    const symlink = join(CLAUDE_SKILLS_DIR, skillName);
    try {
      if (existsSync(symlink)) {
        // Remove old file or symlink
        if (lstatSync(symlink).isSymbolicLink() || lstatSync(symlink).isFile()) {
          unlinkSync(symlink);
        } else {
          rmSync(symlink, { recursive: true, force: true });
        }
      }
      const relativeTarget = join("..", "..", ".agents", "skills", skillName);
      symlinkSync(relativeTarget, symlink);
    } catch {
      // Non-critical — skill still works from ~/.agents/skills/
    }

    console.log(`[mink] installed: ${skillName} -> ${destDir}`);
  }

  console.log();
  console.log("  Restart your Claude Code session to use the new skills.");
}

function skillUninstall(name?: string): void {
  const skills = name ? [name] : getAvailableSkills();

  for (const skillName of skills) {
    const destDir = join(AGENTS_SKILLS_DIR, skillName);

    if (!existsSync(destDir)) {
      console.log(`[mink] not installed: ${skillName}`);
      continue;
    }

    rmSync(destDir, { recursive: true, force: true });

    // Remove symlink from ~/.claude/skills/
    const symlink = join(CLAUDE_SKILLS_DIR, skillName);
    try {
      if (existsSync(symlink)) unlinkSync(symlink);
    } catch {
      // Non-critical
    }

    console.log(`[mink] uninstalled: ${skillName}`);
  }
}

function skillList(): void {
  const available = getAvailableSkills();
  const installed = available.filter(isInstalled);
  const notInstalled = available.filter((s) => !installed.includes(s));

  console.log("[mink] skills:");
  console.log();

  if (installed.length > 0) {
    console.log("  Installed:");
    for (const s of installed) {
      console.log(`    ${s}  (${join(AGENTS_SKILLS_DIR, s)})`);
    }
  }

  if (notInstalled.length > 0) {
    console.log("  Available:");
    for (const s of notInstalled) {
      console.log(`    ${s}`);
    }
  }

  if (available.length === 0) {
    console.log("  No skills available.");
  }

  console.log();
  console.log("  Install with: mink skill install");
  console.log("  Or via skills CLI: npx skills add drewpayment/mink");
}

function copyDirRecursive(src: string, dest: string): void {
  const entries = readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    if (entry.isDirectory()) {
      mkdirSync(destPath, { recursive: true });
      copyDirRecursive(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}
