export type NoteCategory =
  | "inbox"
  | "projects"
  | "areas"
  | "resources"
  | "archives";

export const NOTE_CATEGORIES: NoteCategory[] = [
  "inbox",
  "projects",
  "areas",
  "resources",
  "archives",
];

export interface NoteMetadata {
  title: string;
  category: NoteCategory;
  tags: string[];
  created: string;
  updated: string;
  template?: string;
  projectSlug?: string;
  sourceProject?: string;
  body: string;
}

export interface NoteFrontmatter {
  created: string;
  updated: string;
  tags: string[];
  category: NoteCategory;
  source_project?: string;
  aliases?: string[];
  [key: string]: unknown;
}

export interface VaultManifest {
  version: number;
  createdAt: string;
  totalNotes: number;
  categories: Record<NoteCategory, number>;
  lastOrganized: string;
}

export interface VaultIndexEntry {
  filePath: string;
  title: string;
  description: string;
  tags: string[];
  category: NoteCategory;
  estimatedTokens: number;
  lastModified: string;
}

export interface VaultIndex {
  lastScanTimestamp: string;
  totalNotes: number;
  entries: Record<string, VaultIndexEntry>;
}
