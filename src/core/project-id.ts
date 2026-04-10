import { createHash } from "crypto";
import { basename } from "path";

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function generateProjectId(absolutePath: string): string {
  const normalized = absolutePath.replace(/\/+$/, "");
  const slug = slugify(basename(normalized));
  const hash = createHash("sha256")
    .update(normalized)
    .digest("hex")
    .slice(0, 6);
  return `${slug}-${hash}`;
}
