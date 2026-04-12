import { join } from "path";
import { existsSync, writeFileSync, readFileSync, mkdirSync } from "fs";

export const DEFAULT_TEMPLATES: Record<string, string> = {
  "quick-capture": `---
created: "{{created}}"
updated: "{{updated}}"
tags: []
category: inbox
---

# {{title}}

{{body}}
`,

  "daily-note": `---
created: "{{created}}"
updated: "{{updated}}"
tags: [daily]
category: areas
---

# {{date}}

## Focus

-

## Notes

-

## Tasks

- [ ]

## Reflections

`,

  meeting: `---
created: "{{created}}"
updated: "{{updated}}"
tags: [meeting]
category: areas
---

# {{title}}

**Date**: {{date}}
**Attendees**:

## Agenda

-

## Discussion

-

## Decisions

-

## Action Items

- [ ]
`,

  project: `---
created: "{{created}}"
updated: "{{updated}}"
tags: [project]
category: projects
status: active
---

# {{title}}

## Overview

{{body}}

## Goals

-

## Key Decisions

-

## Links

-
`,

  area: `---
created: "{{created}}"
updated: "{{updated}}"
tags: [area]
category: areas
---

# {{title}}

## Purpose

{{body}}

## Standards

-

## Key Resources

-
`,

  person: `---
created: "{{created}}"
updated: "{{updated}}"
tags: [person]
category: resources
---

# {{title}}

## Role

## Context

## 1:1 Notes

-

## Key Projects

-
`,
};

export function seedTemplates(templatesDir: string): void {
  mkdirSync(templatesDir, { recursive: true });
  for (const [name, content] of Object.entries(DEFAULT_TEMPLATES)) {
    const filePath = join(templatesDir, `${name}.md`);
    if (!existsSync(filePath)) {
      writeFileSync(filePath, content);
    }
  }
}

export function loadTemplate(
  templatesDir: string,
  templateName: string,
  vars: Record<string, string>
): string | null {
  const filePath = join(templatesDir, `${templateName}.md`);
  let content: string;
  if (existsSync(filePath)) {
    content = readFileSync(filePath, "utf-8");
  } else if (DEFAULT_TEMPLATES[templateName]) {
    content = DEFAULT_TEMPLATES[templateName];
  } else {
    return null;
  }
  return fillTemplate(content, vars);
}

export function fillTemplate(
  template: string,
  vars: Record<string, string>
): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replaceAll(`{{${key}}}`, value);
  }
  return result;
}
