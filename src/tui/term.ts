/**
 * Terminal session management: alternate screen, raw mode, cursor, resize
 * signaling, and raw-byte key parsing. Uses only APIs that behave
 * identically under Node (>=24) and Bun: process.stdout.write/columns/rows
 * and process.stdin.setRawMode/on("data").
 */

// ── Escape sequences ─────────────────────────────────────────────────────
const ENTER_ALT_SCREEN = "\x1b[?1049h";
const EXIT_ALT_SCREEN = "\x1b[?1049l";
const HIDE_CURSOR = "\x1b[?25l";
const SHOW_CURSOR = "\x1b[?25h";

/** True only when both stdout and stdin are real TTYs — the guard for entering the TUI at all. */
export function isInteractive(): boolean {
  return !!process.stdout.isTTY && !!process.stdin.isTTY;
}

let entered = false;

/** Switches to the alternate screen, hides the cursor, and puts stdin in raw mode. */
export function enterTui(): void {
  if (entered) return;
  entered = true;
  process.stdout.write(ENTER_ALT_SCREEN + HIDE_CURSOR);
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.resume();
}

/** Restores the terminal to its pre-TUI state. Safe to call multiple times or before enterTui(). */
export function exitTui(): void {
  if (!entered) return;
  entered = false;
  try {
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
  } catch {
    // stdin may already be torn down (e.g. during process exit) — nothing to restore.
  }
  process.stdout.write(SHOW_CURSOR + EXIT_ALT_SCREEN);
}

/**
 * Wires terminal restoration to every process exit path — normal exit,
 * Ctrl-C, SIGTERM, and crashes — so a bug in the TUI can never leave the
 * user's terminal stuck in alternate-screen/raw mode.
 */
let safetyNetInstalled = false;

export function installSafetyNet(): void {
  if (safetyNetInstalled) return;
  safetyNetInstalled = true;
  process.on("exit", () => exitTui());
  process.on("SIGINT", () => {
    exitTui();
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    exitTui();
    process.exit(143);
  });
  process.on("uncaughtException", (err) => {
    exitTui();
    console.error(err);
    process.exit(1);
  });
  process.on("unhandledRejection", (err) => {
    exitTui();
    console.error(err);
    process.exit(1);
  });
}

/**
 * Invokes `cb` with the new terminal size on SIGWINCH or stdout "resize",
 * debounced 50ms since both can fire in quick bursts during a drag-resize.
 * Returns an unsubscribe function.
 */
export function onResize(cb: (cols: number, rows: number) => void): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const handler = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      // 0 is a real pre-window-size pty value — `||` covers 0 and undefined.
      cb(process.stdout.columns || 80, process.stdout.rows || 24);
    }, 50);
  };

  process.stdout.on("resize", handler);
  if (process.platform !== "win32") process.on("SIGWINCH", handler);

  return () => {
    process.stdout.off("resize", handler);
    if (process.platform !== "win32") process.off("SIGWINCH", handler);
    if (timer) clearTimeout(timer);
  };
}

// ── Key parsing ──────────────────────────────────────────────────────────

export interface Key {
  name: string;
  ctrl: boolean;
  shift?: boolean;
}

const ARROW_NAMES: Record<string, string> = { A: "up", B: "down", C: "right", D: "left" };

function parseKeys(input: string): Key[] {
  const keys: Key[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];

    if (ch === "\x1b") {
      if (input[i + 1] === "[" && ARROW_NAMES[input[i + 2] ?? ""]) {
        keys.push({ name: ARROW_NAMES[input[i + 2]], ctrl: false });
        i += 3;
        continue;
      }
      if (input[i + 1] === "[" && input[i + 2] === "Z") {
        // CSI Z — the standard "back tab" sequence a terminal sends for Shift-Tab.
        keys.push({ name: "tab", ctrl: false, shift: true });
        i += 3;
        continue;
      }
      keys.push({ name: "escape", ctrl: false });
      i += 1;
      continue;
    }

    if (ch === "\r" || ch === "\n") {
      keys.push({ name: "return", ctrl: false });
      i += 1;
      continue;
    }
    if (ch === "\t") {
      keys.push({ name: "tab", ctrl: false });
      i += 1;
      continue;
    }
    if (ch === "\x7f" || ch === "\b") {
      keys.push({ name: "backspace", ctrl: false });
      i += 1;
      continue;
    }

    const code = ch.charCodeAt(0);
    if (code === 3) {
      keys.push({ name: "c", ctrl: true }); // Ctrl-C
      i += 1;
      continue;
    }
    if (code > 0 && code < 32) {
      // Other control chars map to Ctrl+<letter> (Ctrl-A = 1 => 'a', etc).
      keys.push({ name: String.fromCharCode(code + 96), ctrl: true });
      i += 1;
      continue;
    }

    keys.push({ name: ch, ctrl: false });
    i += 1;
  }
  return keys;
}

/** Subscribes to parsed key events from raw stdin bytes. Returns an unsubscribe function. */
export function readKeys(cb: (key: Key) => void): () => void {
  const onData = (data: Buffer | string) => {
    const str = typeof data === "string" ? data : data.toString("utf8");
    for (const key of parseKeys(str)) cb(key);
  };
  process.stdin.on("data", onData);
  return () => process.stdin.off("data", onData);
}
