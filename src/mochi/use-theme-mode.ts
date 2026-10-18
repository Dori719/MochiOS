import { useEffect, useState } from "react";
import type { MochiTheme } from "./schema";
import type { MochiCustomThemeMode } from "./color";

/** Resolve Mochi's auto mode for the custom palette calculated in JavaScript. */
export function useMochiThemeMode(theme: MochiTheme): MochiCustomThemeMode {
  const [systemPrefersDark, setSystemPrefersDark] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches,
  );

  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (event: MediaQueryListEvent) => setSystemPrefersDark(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return theme === "dark" || (theme === "auto" && systemPrefersDark) ? "dark" : "light";
}