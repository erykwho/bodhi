import * as SystemUI from "expo-system-ui";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useColorScheme } from "react-native";
import {
  BODHI_COLORS,
  type BodhiColorPalette,
  type BodhiThemeMode,
} from "@bodhi/core/theme";
import {
  readThemePreference,
  type ThemePreference,
  writeThemePreference,
} from "../platform/storage";

interface ThemeContextValue {
  preference: ThemePreference;
  mode: BodhiThemeMode;
  colors: BodhiColorPalette;
  setPreference: (next: ThemePreference) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>(() =>
    readThemePreference()
  );

  const mode: BodhiThemeMode =
    preference === "system"
      ? systemScheme === "dark"
        ? "dark"
        : "light"
      : preference;

  const colors = BODHI_COLORS[mode];

  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(colors.background).catch(() => {});
  }, [colors.background]);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    writeThemePreference(next);
  }, []);

  const toggleTheme = useCallback(() => {
    const next: ThemePreference = mode === "dark" ? "light" : "dark";
    setPreferenceState(next);
    writeThemePreference(next);
  }, [mode]);

  const value = useMemo(
    () => ({ preference, mode, colors, setPreference, toggleTheme }),
    [preference, mode, colors, setPreference, toggleTheme]
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useBodhiTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useBodhiTheme must be used within ThemeProvider");
  }
  return ctx;
}
