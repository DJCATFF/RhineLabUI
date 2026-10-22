import { normalizeQuality, type RenderQuality } from "../render-quality";

export type Preferences = {
  sound: boolean;
  music: boolean;
  soundVolume: number;
  musicVolume: number;
  reduced: boolean;
  quality: boolean;
  superPerformance: boolean;
  rendering: RenderQuality;
  colorTheme: "light" | "dark";
};

export const SETTINGS_KEY = "rhine-settings";

function readStored(): Partial<Preferences> {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "null") ?? {};
  } catch {
    return {};
  }
}

/** Defaults overlaid with whatever was persisted last session. */
export function loadPreferences(): Preferences {
  const stored = readStored();
  return {
    sound: true,
    music: stored.sound ?? true,
    soundVolume: .55,
    musicVolume: .5,
    reduced: matchMedia("(prefers-reduced-motion: reduce)").matches,
    quality: true,
    superPerformance: false,
    ...stored,
    rendering: normalizeQuality(stored.rendering, stored.quality !== false),
    colorTheme: stored.colorTheme === "dark" ? "dark" : "light",
  };
}

/** Persists the preference object; storage may be unavailable in private mode. */
export function persistPreferences(prefs: Preferences) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(prefs));
  } catch {}
}
