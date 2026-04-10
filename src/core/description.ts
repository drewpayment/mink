import { basename, extname } from "path";

const MAX_DESCRIPTION_LENGTH = 100;

const CONFIG_DESCRIPTIONS: Record<string, string> = {
  "package.json": "Node.js package manifest",
  "tsconfig.json": "TypeScript configuration",
  "tsconfig.node.json": "TypeScript configuration (Node)",
  "tailwind.config.js": "Tailwind CSS configuration",
  "tailwind.config.ts": "Tailwind CSS configuration",
  "vite.config.js": "Vite build configuration",
  "vite.config.ts": "Vite build configuration",
  "next.config.js": "Next.js configuration",
  "next.config.ts": "Next.js configuration",
  "next.config.mjs": "Next.js configuration",
  "eslint.config.js": "ESLint configuration",
  "eslint.config.mjs": "ESLint configuration",
  ".eslintrc": "ESLint configuration",
  ".eslintrc.js": "ESLint configuration",
  ".eslintrc.json": "ESLint configuration",
  ".prettierrc": "Prettier configuration",
  ".prettierrc.json": "Prettier configuration",
  "prettier.config.js": "Prettier configuration",
  "Dockerfile": "Docker container definition",
  "docker-compose.yml": "Docker Compose services",
  "docker-compose.yaml": "Docker Compose services",
  "Makefile": "Make build targets",
  "CMakeLists.txt": "CMake build configuration",
  "Cargo.toml": "Rust package manifest",
  "go.mod": "Go module definition",
  "pyproject.toml": "Python project configuration",
  "setup.py": "Python package setup",
  "Gemfile": "Ruby dependency manifest",
  "composer.json": "PHP package manifest",
  "build.gradle": "Gradle build configuration",
  "pom.xml": "Maven build configuration",
  "bunfig.toml": "Bun configuration",
};

function truncate(str: string): string {
  if (str.length <= MAX_DESCRIPTION_LENGTH) return str;
  return str.slice(0, MAX_DESCRIPTION_LENGTH - 3) + "...";
}

function hasBinaryContent(content: string): boolean {
  return content.includes("\0");
}

function extractMarkdownHeading(content: string): string | null {
  const match = content.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : null;
}

function extractHtmlTitle(content: string): string | null {
  const match = content.match(/<title[^>]*>([^<]+)<\/title>/i);
  return match ? match[1].trim() : null;
}

function extractDocComment(content: string): string | null {
  // JSDoc / JavaDoc style: /** ... */
  const jsdoc = content.match(/^\/\*\*\s*\n?\s*\*?\s*(.+)/m);
  if (jsdoc) return jsdoc[1].replace(/\*\/\s*$/, "").trim();

  // Python docstring: """...""" or '''...'''
  const pydoc = content.match(/^(?:def |class ).*\n\s*(?:"""|''')(.+)/m);
  if (pydoc) return pydoc[1].trim();

  // Shell/Ruby/Python top-of-file comment block
  const lines = content.split("\n");
  if (lines[0]?.startsWith("#!")) {
    // Skip shebang, look at next comment
    for (let i = 1; i < Math.min(lines.length, 5); i++) {
      const line = lines[i].trim();
      if (line.startsWith("# ") && line.length > 2) {
        return line.slice(2).trim();
      }
      if (line && !line.startsWith("#")) break;
    }
  } else if (lines[0]?.startsWith("# ") && lines[0].length > 2) {
    return lines[0].slice(2).trim();
  }

  return null;
}

function extractExports(content: string): string | null {
  const exports: string[] = [];
  const re = /export\s+(?:function|const|class|interface|type|enum)\s+(\w+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    exports.push(match[1]);
  }
  if (exports.length === 0) return null;
  return `exports: ${exports.join(", ")}`;
}

function extractComponent(content: string, filePath: string): string | null {
  const ext = extname(filePath).toLowerCase();
  if (![".tsx", ".jsx", ".vue", ".svelte"].includes(ext)) return null;

  const nameMatch = content.match(
    /(?:export\s+(?:default\s+)?function|const)\s+(\w+)/
  );
  const componentName = nameMatch ? nameMatch[1] : basename(filePath, ext);

  const elements: string[] = [];
  if (/<form[\s>]/i.test(content)) elements.push("form");
  if (/<table[\s>]/i.test(content)) elements.push("table");
  if (/modal/i.test(content)) elements.push("modal");
  if (/<ul[\s>]|<ol[\s>]|<li[\s>]/i.test(content)) elements.push("list");
  if (/<input[\s>]|<textarea[\s>]|<select[\s>]/i.test(content))
    elements.push("inputs");

  if (elements.length === 0) return null;
  return `${componentName} — renders ${elements.join(", ")}`;
}

function extractCiWorkflow(content: string, filePath: string): string | null {
  const normalized = filePath.replace(/\\/g, "/");
  const isCi =
    normalized.includes(".github/workflows/") ||
    normalized.includes(".gitlab-ci") ||
    basename(filePath).toLowerCase() === "jenkinsfile";
  if (!isCi) return null;

  const nameMatch = content.match(/^name:\s*(.+)$/m);
  if (nameMatch) return `CI: ${nameMatch[1].trim()}`;
  return `CI: ${basename(filePath)}`;
}

function extractMigration(content: string, filePath: string): string | null {
  const normalized = filePath.toLowerCase();
  const isMigration =
    normalized.includes("migration") || normalized.includes("migrate");
  if (!isMigration) return null;

  const tableMatch = content.match(
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?(\w+)/i
  );
  if (tableMatch) return `migration: create ${tableMatch[1]}`;
  return `migration: ${basename(filePath)}`;
}

function extractFallback(content: string): string | null {
  const lines = content.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("//") && !trimmed.startsWith("#")) {
      return trimmed;
    }
  }
  return null;
}

export function extractDescription(filePath: string, content: string): string {
  const name = basename(filePath);
  const ext = extname(filePath).toLowerCase();

  // Edge cases first
  if (content.length === 0) return `${name} — empty file`;
  if (hasBinaryContent(content)) return `${name} — binary file`;

  let description: string | null = null;
  const isLargeFile = content.length > 100 * 1024;

  // Priority 1: Markdown heading
  if ([".md", ".mdx"].includes(ext)) {
    description = extractMarkdownHeading(content);
  }

  // Priority 2: HTML title
  if (!description && [".html", ".htm"].includes(ext)) {
    description = extractHtmlTitle(content);
  }

  // Priority 3: Doc comment
  if (!description) {
    description = extractDocComment(content);
  }

  // Priority 4: Exports
  if (!description) {
    description = extractExports(content);
  }

  // Priority 5: Component with elements
  if (!description) {
    description = extractComponent(content, filePath);
  }

  // Priority 6: Known config file
  if (!description) {
    const configDesc = CONFIG_DESCRIPTIONS[name];
    if (configDesc) description = configDesc;
  }

  // Priority 7: CI/CD
  if (!description) {
    description = extractCiWorkflow(content, filePath);
  }

  // Priority 8: Migration
  if (!description) {
    description = extractMigration(content, filePath);
  }

  // Priority 9: Fallback
  if (!description) {
    description = extractFallback(content);
  }

  // Final fallback
  if (!description) {
    description = name;
  }

  if (isLargeFile) {
    description = truncate(description + " (large file)");
  } else {
    description = truncate(description);
  }

  return description;
}
