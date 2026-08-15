"use client";

import { useEffect, useState } from "react";
import styles from "./mail.module.css";

export type ThemePreference = "light" | "dark" | "system";

const THEME_STORAGE_KEY = "quietline/theme";
const THEME_OPTIONS: Array<{ value: ThemePreference; label: string }> = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

function isThemePreference(value: string | undefined): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

function resolveTheme(preference: ThemePreference): "light" | "dark" {
  if (preference !== "system") return preference;
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function applyTheme(preference: ThemePreference): void {
  const theme = resolveTheme(preference);
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.dataset.themePreference = preference;
  root.style.colorScheme = theme;
}

export default function ThemeSwitcher() {
  const [preference, setPreference] = useState<ThemePreference>(() => {
    const initial = document.documentElement.dataset.themePreference;
    return isThemePreference(initial) ? initial : "system";
  });

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const syncSystemTheme = () => {
      if (preference === "system") applyTheme("system");
    };

    applyTheme(preference);
    media.addEventListener("change", syncSystemTheme);
    return () => media.removeEventListener("change", syncSystemTheme);
  }, [preference]);

  useEffect(() => {
    const syncStoredTheme = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY) return;
      const nextPreference = event.newValue ?? undefined;
      setPreference(
        isThemePreference(nextPreference) ? nextPreference : "system",
      );
    };
    window.addEventListener("storage", syncStoredTheme);
    return () => window.removeEventListener("storage", syncStoredTheme);
  }, []);

  function chooseTheme(nextPreference: ThemePreference) {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, nextPreference);
    } catch {
      // The visual preference still applies when storage is unavailable.
    }
    applyTheme(nextPreference);
    setPreference(nextPreference);
  }

  return (
    <fieldset className={styles.themeSwitcher}>
      <legend className={styles.sidebarLabel}>APPEARANCE</legend>
      <div>
        {THEME_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={preference === option.value}
            onClick={() => chooseTheme(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}
