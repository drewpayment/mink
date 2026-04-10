const CODE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".java",
  ".c", ".cpp", ".h", ".hpp", ".cs", ".rb", ".php", ".swift",
  ".kt", ".scala", ".sh", ".bash", ".zsh", ".sql", ".graphql",
]);

const PROSE_EXTENSIONS = new Set([
  ".md", ".mdx", ".txt", ".rst", ".adoc", ".tex",
]);

export function estimateTokens(content: string, filePath: string): number {
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  let ratio: number;
  if (CODE_EXTENSIONS.has(ext)) {
    ratio = 3.5;
  } else if (PROSE_EXTENSIONS.has(ext)) {
    ratio = 4.0;
  } else {
    ratio = 3.75;
  }
  return Math.ceil(content.length / ratio);
}
