export type BodhiThemeMode = "light" | "dark";

export interface BodhiColorPalette {
  background: string;
  surface: string;
  surfaceMuted: string;
  foreground: string;
  foregroundMuted: string;
  accent: string;
  accentStrong: string;
  accentSoft: string;
  warmAmber: string;
  border: string;
  danger: string;
  oledBlack: string;
}

/**
 * Single source of truth for Bodhi's organic serene palette.
 * Mirrors the CSS custom properties in `src/app/globals.css`.
 */
export const BODHI_COLORS: Record<BodhiThemeMode, BodhiColorPalette> = {
  light: {
    background: "#f5f2eb",
    surface: "#fcfaf6",
    surfaceMuted: "#ece7dc",
    foreground: "#232a26",
    foregroundMuted: "#5c665f",
    accent: "#4a6b5d",
    accentStrong: "#3b584b",
    accentSoft: "#e3ebe6",
    warmAmber: "#c88a55",
    border: "rgba(35, 42, 38, 0.10)",
    danger: "#b84b44",
    oledBlack: "#000000",
  },
  dark: {
    background: "#151917",
    surface: "#1d2320",
    surfaceMuted: "#262e2a",
    foreground: "#eceae4",
    foregroundMuted: "#9aa69e",
    accent: "#7da390",
    accentStrong: "#92b6a4",
    accentSoft: "#24322b",
    warmAmber: "#d49b63",
    border: "rgba(236, 234, 228, 0.10)",
    danger: "#e06c64",
    oledBlack: "#000000",
  },
} as const;

export const BODHI_TYPOGRAPHY = {
  sansFamily: "PlusJakartaSans",
  monoFamily: "JetBrainsMono",
} as const;

export const BODHI_RADIUS = {
  sm: 10,
  md: 16,
  lg: 24,
  full: 9999,
} as const;

export const BODHI_SPACING = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;
