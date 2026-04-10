import { basename } from "path";

/**
 * Returns true if the file should be excluded from write tracking.
 * Excluded: .env* files, files inside the .mink state directory.
 */
export function isWriteExcluded(relativePath: string): boolean {
  // Skip .mink state directory files
  if (
    relativePath === ".mink" ||
    relativePath.startsWith(".mink/") ||
    relativePath.startsWith(".mink\\")
  ) {
    return true;
  }

  // Skip .env files
  const name = basename(relativePath);
  if (name === ".env" || name.startsWith(".env.")) {
    return true;
  }

  return false;
}
