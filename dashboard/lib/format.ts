export function formatNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}

export function formatUptime(ms: number): string {
  if (!ms || ms <= 0) return "\u2014";
  const sec = Math.floor(ms / 1000);
  const min = Math.floor(sec / 60);
  const hr = Math.floor(min / 60);
  if (hr > 0) return hr + "h " + (min % 60) + "m";
  if (min > 0) return min + "m " + (sec % 60) + "s";
  return sec + "s";
}

export function formatDate(iso: string): string {
  if (!iso) return "\u2014";
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return iso;
  }
}

export function formatDateTime(iso: string): string {
  if (!iso) return "\u2014";
  try {
    const d = new Date(iso);
    return (
      d.toLocaleDateString() +
      " " +
      d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    );
  } catch {
    return iso;
  }
}
