import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { TimezoneMode, ClockFormat } from "@/lib/format";

export type Accent = "green" | "amber" | "blue" | "violet";
export type Density = "compact" | "comfortable" | "spacious";

interface PreferencesState {
  accent: Accent;
  density: Density;
  liveFeel: boolean;
  timezone: TimezoneMode;
  clock: ClockFormat;
  tweaksOpen: boolean;

  setAccent: (a: Accent) => void;
  setDensity: (d: Density) => void;
  setLiveFeel: (v: boolean) => void;
  setTimezone: (t: TimezoneMode) => void;
  setClock: (c: ClockFormat) => void;
  setTweaksOpen: (v: boolean) => void;
}

export const usePreferences = create<PreferencesState>()(
  persist(
    (set) => ({
      accent: "green",
      density: "compact",
      liveFeel: true,
      timezone: "local",
      clock: "24h",
      tweaksOpen: false,

      setAccent: (accent) => set({ accent }),
      setDensity: (density) => set({ density }),
      setLiveFeel: (liveFeel) => set({ liveFeel }),
      setTimezone: (timezone) => set({ timezone }),
      setClock: (clock) => set({ clock }),
      setTweaksOpen: (tweaksOpen) => set({ tweaksOpen }),
    }),
    {
      name: "mink-preferences",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        accent: s.accent,
        density: s.density,
        liveFeel: s.liveFeel,
        timezone: s.timezone,
        clock: s.clock,
      }),
    },
  ),
);
