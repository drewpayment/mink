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

// A deterministic, dependency-free token counter that segments text the way a
// BPE tokenizer roughly would — on word, number, and punctuation boundaries —
// rather than dividing by a single flat character ratio. It is more faithful
// than `estimateTokens` (which exists for the file-index hot path and is pinned
// by exact-ratio tests), and crucially it does not need a file extension, so it
// can score arbitrary tool output (logs, search results, command output).
//
// It is intentionally NOT a real BPE vocabulary: Mink ships as a lean CLI with a
// single runtime dependency, and the compression-measurement use only needs a
// *consistent* estimator to compute an original-minus-compressed delta. The
// signature is stable, so a real BPE library can be dropped in behind it later
// without touching call sites.
//
// Segmentation: runs of ASCII letters and runs of digits each collapse to a
// handful of sub-word tokens; every other character (punctuation, symbols,
// non-ASCII, whitespace) is scored individually. Whitespace usually merges into
// an adjacent token in real tokenizers, so spaces and tabs cost nothing and only
// newlines count.
export function countTokens(text: string): number {
  if (!text) return 0;
  const segments = text.match(/[A-Za-z]+|[0-9]+|[^A-Za-z0-9]/g);
  if (!segments) return 0;
  let tokens = 0;
  for (const seg of segments) {
    const first = seg.charCodeAt(0);
    if ((first >= 65 && first <= 90) || (first >= 97 && first <= 122)) {
      tokens += Math.ceil(seg.length / 4); // word splits into ~4-char sub-words
    } else if (first >= 48 && first <= 57) {
      tokens += Math.ceil(seg.length / 3); // digit runs tokenize more finely
    } else if (seg === "\n") {
      tokens += 1; // newlines are their own token
    } else if (seg === " " || seg === "\t" || seg === "\r") {
      // whitespace merges into the adjacent token — no extra cost
    } else {
      tokens += 1; // punctuation / symbol / non-ASCII char
    }
  }
  return tokens;
}
