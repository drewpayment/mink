"use client";

import { useTheme } from "next-themes";
import { usePreferences, type Accent, type Density } from "@/hooks/use-preferences";

const ACCENTS: Array<[Accent, string]> = [
  ["green",  "oklch(0.76 0.14 155)"],
  ["amber",  "oklch(0.80 0.15 75)"],
  ["blue",   "oklch(0.72 0.14 245)"],
  ["violet", "oklch(0.72 0.14 295)"],
];

const DENSITIES: Array<[Density, string]> = [
  ["compact", "S"],
  ["comfortable", "M"],
  ["spacious", "L"],
];

export function Tweaks() {
  const open = usePreferences((s) => s.tweaksOpen);
  const setOpen = usePreferences((s) => s.setTweaksOpen);

  const { theme, setTheme, resolvedTheme } = useTheme();
  const currentTheme = (theme === "system" ? resolvedTheme : theme) ?? "dark";

  const accent = usePreferences((s) => s.accent);
  const setAccent = usePreferences((s) => s.setAccent);
  const density = usePreferences((s) => s.density);
  const setDensity = usePreferences((s) => s.setDensity);
  const liveFeel = usePreferences((s) => s.liveFeel);
  const setLiveFeel = usePreferences((s) => s.setLiveFeel);
  const timezone = usePreferences((s) => s.timezone);
  const setTimezone = usePreferences((s) => s.setTimezone);
  const clock = usePreferences((s) => s.clock);
  const setClock = usePreferences((s) => s.setClock);

  if (!open) return null;

  let localZone = "";
  try {
    localZone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
  } catch {
    localZone = "";
  }

  return (
    <div className="tweaks" role="dialog" aria-label="Tweaks">
      <div className="row" style={{ marginBottom: 6 }}>
        <h4 style={{ margin: 0 }}>Tweaks</h4>
        <button
          type="button"
          className="tb-icon-btn"
          style={{ marginLeft: "auto" }}
          onClick={() => setOpen(false)}
          aria-label="Close tweaks"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M6 6l12 12M6 18L18 6" />
          </svg>
        </button>
      </div>

      <div className="tw-row">
        <span className="label">Theme</span>
        <div className="seg">
          {(["light", "dark"] as const).map((t) => (
            <button
              key={t}
              type="button"
              className={currentTheme === t ? "on" : ""}
              onClick={() => setTheme(t)}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="tw-row">
        <span className="label">Accent</span>
        <div className="swatches">
          {ACCENTS.map(([name, col]) => (
            <button
              key={name}
              type="button"
              className={`sw ${accent === name ? "on" : ""}`.trim()}
              style={{ background: col }}
              title={name}
              aria-label={`Accent ${name}`}
              onClick={() => setAccent(name)}
            />
          ))}
        </div>
      </div>

      <div className="tw-row">
        <span className="label">Density</span>
        <div className="seg">
          {DENSITIES.map(([k, l]) => (
            <button
              key={k}
              type="button"
              className={density === k ? "on" : ""}
              onClick={() => setDensity(k)}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      <div className="tw-row">
        <span className="label">
          Timezone
          {timezone === "local" && localZone && (
            <span className="muted" style={{ marginLeft: 6, fontSize: 10.5 }}>
              {localZone}
            </span>
          )}
        </span>
        <div className="seg">
          {([["local", "Local"], ["utc", "UTC"]] as const).map(([k, l]) => (
            <button
              key={k}
              type="button"
              className={timezone === k ? "on" : ""}
              onClick={() => setTimezone(k)}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      <div className="tw-row">
        <span className="label">Clock</span>
        <div className="seg">
          {([["12h", "12h"], ["24h", "24h"]] as const).map(([k, l]) => (
            <button
              key={k}
              type="button"
              className={clock === k ? "on" : ""}
              onClick={() => setClock(k)}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      <div className="tw-row">
        <span className="label">Live indicators</span>
        <button
          type="button"
          role="switch"
          aria-checked={liveFeel}
          className={`toggle ${liveFeel ? "on" : ""}`.trim()}
          onClick={() => setLiveFeel(!liveFeel)}
        />
      </div>
    </div>
  );
}
