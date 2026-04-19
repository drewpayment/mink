import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export type Accent = "green" | "amber" | "blue" | "violet";
export type Density = "compact" | "comfortable" | "spacious";
export type DaemonOverride = "auto" | "online" | "offline";

interface PreferencesState {
  accent: Accent;
  density: Density;
  liveFeel: boolean;
  daemonOverride: DaemonOverride;
  tweaksOpen: boolean;

  setAccent: (a: Accent) => void;
  setDensity: (d: Density) => void;
  setLiveFeel: (v: boolean) => void;
  setDaemonOverride: (v: DaemonOverride) => void;
  setTweaksOpen: (v: boolean) => void;
}

export const usePreferences = create<PreferencesState>()(
  persist(
    (set) => ({
      accent: "green",
      density: "compact",
      liveFeel: true,
      daemonOverride: "auto",
      tweaksOpen: false,

      setAccent: (accent) => set({ accent }),
      setDensity: (density) => set({ density }),
      setLiveFeel: (liveFeel) => set({ liveFeel }),
      setDaemonOverride: (daemonOverride) => set({ daemonOverride }),
      setTweaksOpen: (tweaksOpen) => set({ tweaksOpen }),
    }),
    {
      name: "mink-preferences",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        accent: s.accent,
        density: s.density,
        liveFeel: s.liveFeel,
        daemonOverride: s.daemonOverride,
      }),
    },
  ),
);
