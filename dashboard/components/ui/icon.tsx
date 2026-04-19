export type IconName =
  | "pulse" | "activity" | "layers" | "database" | "sparkles" | "brain" | "bug"
  | "file" | "folder" | "clock" | "alert" | "settings" | "link" | "git"
  | "discord" | "chev" | "chevDown" | "play" | "pause" | "stop" | "plus"
  | "search" | "refresh" | "dots" | "check" | "x" | "download" | "upload"
  | "arrowUp" | "arrowDown" | "trash" | "home" | "command" | "archive"
  | "terminal" | "wand" | "tag" | "calendar" | "list" | "grid" | "eye"
  | "chart" | "book" | "copy" | "power" | "stack";

const ICONS: Record<IconName, string> = {
  pulse:       "M2 12h4l2-7 4 14 2-7h6",
  activity:    "M22 12h-4l-3 9L9 3l-3 9H2",
  layers:      "M12 2l10 6-10 6L2 8l10-6zm0 10l10 6-10 6L2 18l10-6z",
  database:    "M4 5a8 3 0 1016 0 8 3 0 10-16 0v14a8 3 0 0016 0V5",
  sparkles:    "M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5zM20 15l.8 2.2L23 18l-2.2.8L20 21l-.8-2.2L17 18l2.2-.8z",
  brain:       "M12 4a4 4 0 00-4 4v1a3 3 0 00-2 5.5A3 3 0 008 19a4 4 0 004 2 4 4 0 004-2 3 3 0 002-4.5A3 3 0 0016 9V8a4 4 0 00-4-4z",
  bug:         "M8 8V6a4 4 0 018 0v2M4 13h16M12 8v13M7 21s-3-2-3-8M17 21s3-2 3-8M8 9l-4-3M16 9l4-3M8 13l-4 3M16 13l4 3",
  file:        "M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z",
  folder:      "M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z",
  clock:       "M12 22a10 10 0 100-20 10 10 0 000 20zm0-16v6l4 2",
  alert:       "M12 2l11 20H1L12 2zm0 7v5m0 4v0",
  settings:    "M12 15a3 3 0 100-6 3 3 0 000 6zm8-3l2-1-2-4-2 1-1-1V4h-4v1l-1 1-2-1-2 4 2 1v2l-2 1 2 4 2-1 1 1v1h4v-1l1-1 2 1 2-4-2-1v-2z",
  link:        "M10 13a5 5 0 007 0l3-3a5 5 0 00-7-7l-1 1M14 11a5 5 0 00-7 0l-3 3a5 5 0 007 7l1-1",
  git:         "M6 3v12M6 15a3 3 0 110 6 3 3 0 010-6zm0-12a3 3 0 110 6 3 3 0 010-6zm12 6a3 3 0 110 6 3 3 0 010-6zM18 9v2a2 2 0 01-2 2H9",
  discord:     "M9 14a1 1 0 100-2 1 1 0 000 2zm6 0a1 1 0 100-2 1 1 0 000 2zM7 7l2-1h6l2 1 2 5-1 5-3 1-1-2-4 0-1 2-3-1-1-5z",
  chev:        "M9 6l6 6-6 6",
  chevDown:    "M6 9l6 6 6-6",
  play:        "M6 4l14 8-14 8z",
  pause:       "M7 4h4v16H7zM13 4h4v16h-4z",
  stop:        "M6 6h12v12H6z",
  plus:        "M12 5v14M5 12h14",
  search:      "M21 21l-5-5m2-6a8 8 0 11-16 0 8 8 0 0116 0z",
  refresh:     "M3 12a9 9 0 019-9c2.5 0 4.7 1 6.3 2.7M21 3v5h-5M21 12a9 9 0 01-9 9c-2.5 0-4.7-1-6.3-2.7M3 21v-5h5",
  dots:        "M5 12a1 1 0 102 0 1 1 0 00-2 0zm6 0a1 1 0 102 0 1 1 0 00-2 0zm6 0a1 1 0 102 0 1 1 0 00-2 0z",
  check:       "M20 6L9 17l-5-5",
  x:           "M6 6l12 12M6 18L18 6",
  download:    "M12 3v13m0 0l-5-5m5 5l5-5M4 21h16",
  upload:      "M12 21V8m0 0l-5 5m5-5l5 5M4 3h16",
  arrowUp:     "M12 19V5m0 0l-7 7m7-7l7 7",
  arrowDown:   "M12 5v14m0 0l-7-7m7 7l7-7",
  trash:       "M4 7h16M10 7V4h4v3m-6 0v13h8V7",
  home:        "M3 12l9-9 9 9M5 10v10h14V10",
  command:     "M6 3a3 3 0 013 3v12a3 3 0 11-3-3h12a3 3 0 113 3V6a3 3 0 11-3 3H6",
  archive:     "M3 7h18v4H3zM5 11v9h14v-9M10 14h4",
  terminal:    "M4 5h16v14H4zM8 9l3 3-3 3M13 15h4",
  wand:        "M15 4V2m0 14v-2m-7-7h2M22 9h-2M5.6 5.6l1.4 1.4M18.4 5.6L17 7m0 10l1.4 1.4M7 17l-1.4 1.4M14 7l-9 9 3 3 9-9",
  tag:         "M20 13l-7 7a2 2 0 01-3 0L3 13V4h9l8 9zM7 7h.01",
  calendar:    "M3 7h18v13H3zM3 7l0-3h18v3M8 2v4M16 2v4M3 11h18",
  list:        "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  grid:        "M3 3h8v8H3zM13 3h8v8h-8zM3 13h8v8H3zM13 13h8v8h-8z",
  eye:         "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zm10 3a3 3 0 100-6 3 3 0 000 6z",
  chart:       "M3 20h18M6 16V8M11 16V4M16 16v-6M21 16v-3",
  book:        "M4 4h12a4 4 0 014 4v12H8a4 4 0 01-4-4V4zm0 0v16",
  copy:        "M8 5h10a2 2 0 012 2v10M4 9h10a2 2 0 012 2v10H6a2 2 0 01-2-2V9z",
  power:       "M18 6a8 8 0 11-12 0M12 2v8",
  stack:       "M4 6h16M4 12h16M4 18h16",
};

interface IconProps {
  name: IconName;
  size?: number;
  stroke?: number;
  className?: string;
}

export function Icon({ name, size = 14, stroke = 1.7, className = "" }: IconProps) {
  const d = ICONS[name];
  if (!d) return null;
  return (
    <svg
      className={`icn ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={d} />
    </svg>
  );
}
