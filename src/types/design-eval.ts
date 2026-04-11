// ── Design Evaluation Types (Spec 13) ─────────────────────────────────────

export interface Viewport {
  name: "desktop" | "mobile";
  width: number;
  height: number;
}

export interface DesignQcOptions {
  url?: string;
  routes?: string[];
  quality: number;
  desktopOnly: boolean;
  maxSections: number;
}

export interface CaptureResult {
  route: string;
  viewport: string;
  section: number;
  totalSections: number;
  filePath: string;
  fileName: string;
  fileSize: number;
  pageHeight: number;
  statusCode: number;
  timestamp: string;
}

export interface DesignEvalReport {
  capturedAt: string;
  serverUrl: string;
  routes: string[];
  viewports: Viewport[];
  quality: number;
  captures: CaptureResult[];
  errors: Array<{ route: string; viewport: string; error: string }>;
}

// ── Defaults ──────────────────────────────────────────────────────────────

export const DEFAULT_VIEWPORTS: Viewport[] = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 375, height: 812 },
];

export const DEFAULT_QUALITY = 70;
export const DEFAULT_MAX_SECTIONS = 8;

export const DEFAULT_PROBE_PORTS = [
  3000, 3001, 4000, 5000, 5173, 8000, 8080,
];

// ── Type Guard ────────────────────────────────────────────────────────────

export function isDesignEvalReport(v: unknown): v is DesignEvalReport {
  return (
    typeof v === "object" &&
    v !== null &&
    "capturedAt" in v &&
    "captures" in v &&
    Array.isArray((v as DesignEvalReport).captures)
  );
}
