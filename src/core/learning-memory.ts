import type { LearningMemory, SectionName } from "../types/learning-memory";

const SECTION_ORDER: SectionName[] = [
  "User Preferences",
  "Key Learnings",
  "Do-Not-Repeat",
  "Decision Log",
];

const RECOGNIZED_SECTIONS = new Set<string>(SECTION_ORDER);

function emptysections(): Record<SectionName, string[]> {
  return {
    "User Preferences": [],
    "Key Learnings": [],
    "Do-Not-Repeat": [],
    "Decision Log": [],
  };
}

export function createEmptyLearningMemory(projectName: string): LearningMemory {
  return {
    projectName,
    sections: emptysections(),
  };
}

export function parseLearningMemory(markdown: string): LearningMemory {
  const sections = emptysections();
  let projectName = "unknown";

  if (!markdown || markdown.trim() === "") {
    return { projectName, sections };
  }

  const lines = markdown.split("\n");
  let currentSection: SectionName | null = null;

  for (const line of lines) {
    // Check for title line: # Learning Memory — <name>
    const titleMatch = line.match(/^#\s+Learning Memory\s+[—–-]+\s+(.+)$/);
    if (titleMatch) {
      projectName = titleMatch[1].trim();
      currentSection = null;
      continue;
    }

    // Check for section heading: ## Section Name
    const sectionMatch = line.match(/^##\s+(.+)$/);
    if (sectionMatch) {
      const sectionName = sectionMatch[1].trim();
      if (RECOGNIZED_SECTIONS.has(sectionName)) {
        currentSection = sectionName as SectionName;
      } else {
        currentSection = null;
      }
      continue;
    }

    // Check for entry line: - entry
    if (currentSection !== null) {
      const entryMatch = line.match(/^-\s+(.+)$/);
      if (entryMatch) {
        sections[currentSection].push(entryMatch[1]);
      }
    }
  }

  return { projectName, sections };
}

export function serializeLearningMemory(mem: LearningMemory): string {
  const lines: string[] = [];

  lines.push(`# Learning Memory — ${mem.projectName}`);

  for (const section of SECTION_ORDER) {
    lines.push("");
    lines.push(`## ${section}`);
    for (const entry of mem.sections[section]) {
      lines.push(`- ${entry}`);
    }
  }

  return lines.join("\n") + "\n";
}

export function addEntry(
  mem: LearningMemory,
  section: SectionName,
  entry: string
): void {
  mem.sections[section].push(entry);
}

export function removeEntry(
  mem: LearningMemory,
  section: SectionName,
  index: number
): void {
  const entries = mem.sections[section];
  if (index < 0 || index >= entries.length) {
    return;
  }
  entries.splice(index, 1);
}

export function getEntries(
  mem: LearningMemory,
  section: SectionName
): string[] {
  return mem.sections[section];
}

export function totalEntryCount(mem: LearningMemory): number {
  return SECTION_ORDER.reduce(
    (sum, section) => sum + mem.sections[section].length,
    0
  );
}
