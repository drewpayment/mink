import { writeFileSync, readFileSync, renameSync, mkdirSync } from "fs";
import { dirname } from "path";

export function atomicWriteJson(filePath: string, data: unknown): void {
  const tmp = filePath + ".tmp";
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameSync(tmp, filePath);
}

export function atomicWriteText(filePath: string, content: string): void {
  const tmp = filePath + ".tmp";
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(tmp, content);
  renameSync(tmp, filePath);
}

export function safeReadJson(filePath: string): unknown | null {
  try {
    const raw = readFileSync(filePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
