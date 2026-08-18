const root = document.documentElement;
let preference = "system";
try {
  const stored = localStorage.getItem("quietline/theme");
  if (stored === "light" || stored === "dark" || stored === "system") {
    preference = stored;
  }
} catch {
  // Storage can be unavailable; system preference remains a safe default.
}
const dark =
  preference === "dark" ||
  (preference === "system" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches);
const theme = dark ? "dark" : "light";
root.dataset.theme = theme;
root.dataset.themePreference = preference;
root.style.colorScheme = theme;
