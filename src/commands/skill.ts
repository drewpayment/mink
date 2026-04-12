import { join, resolve, dirname } from "path";
import { homedir } from "os";
import { existsSync, mkdirSync, copyFileSync, unlinkSync, readdirSync } from "fs";

const CLAUDE_SKILLS_DIR = join(homedir(), ".claude", "skills");

function getSkillsSourceDir(): string {
  return resolve(dirname(new URL(import.meta.url).pathname), "../skills");
}

function getAvailableSkills(): string[] {
  const dir = getSkillsSourceDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.replace(/\.md$/, ""));
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
      console.log("  install [name]    Install Mink skills to ~/.claude/skills/");
      console.log("  uninstall [name]  Remove installed Mink skills");
      console.log("  list              Show available and installed skills");
      break;
  }
}

function skillInstall(name?: string): void {
  const sourceDir = getSkillsSourceDir();
  const skills = name ? [name] : getAvailableSkills();

  if (skills.length === 0) {
    console.error("[mink] no skills found to install");
    return;
  }

  mkdirSync(CLAUDE_SKILLS_DIR, { recursive: true });

  for (const skillName of skills) {
    const src = join(sourceDir, `${skillName}.md`);
    const dest = join(CLAUDE_SKILLS_DIR, `${skillName}.md`);

    if (!existsSync(src)) {
      console.error(`[mink] skill not found: ${skillName}`);
      continue;
    }

    copyFileSync(src, dest);
    console.log(`[mink] installed: ${skillName} -> ${dest}`);
  }
}

function skillUninstall(name?: string): void {
  const skills = name ? [name] : getAvailableSkills();

  for (const skillName of skills) {
    const dest = join(CLAUDE_SKILLS_DIR, `${skillName}.md`);

    if (!existsSync(dest)) {
      console.log(`[mink] not installed: ${skillName}`);
      continue;
    }

    unlinkSync(dest);
    console.log(`[mink] uninstalled: ${skillName}`);
  }
}

function skillList(): void {
  const available = getAvailableSkills();
  const installed = available.filter((s) =>
    existsSync(join(CLAUDE_SKILLS_DIR, `${s}.md`))
  );
  const notInstalled = available.filter(
    (s) => !installed.includes(s)
  );

  console.log("[mink] skills:");
  console.log();

  if (installed.length > 0) {
    console.log("  Installed:");
    for (const s of installed) {
      console.log(`    ${s}`);
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
  console.log("  Install with: mink skill install [name]");
}
