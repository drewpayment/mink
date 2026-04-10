const CODE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".java",
  ".c", ".cpp", ".h", ".hpp", ".cs", ".rb", ".php", ".swift",
  ".kt", ".scala", ".sh", ".bash", ".zsh", ".sql", ".graphql",
]);

const PROSE_EXTENSIONS = new Set([
  ".md", ".mdx", ".txt", ".rst", ".adoc", ".tex",
]);

const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico",
  ".woff", ".woff2", ".ttf", ".eot",
  ".mp3", ".mp4", ".webm", ".zip", ".tar", ".gz",
  ".pdf", ".exe", ".dll", ".so", ".dylib",
]);

export function isBinaryFile(filePath: string, content?: string): boolean {
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  if (BINARY_EXTENSIONS.has(ext)) return true;
  if (content && content.includes("\0")) return true;
  return false;
}

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
