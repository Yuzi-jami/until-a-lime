import { useEffect, useState } from "react";
import {
  isDark,
  parseAutoLock,
  parseTheme,
  type AutoLockMinutes,
  type ThemePreference,
} from "./preferences";

export function readPreference(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
export function useTheme() {
  const [theme, setTheme] = useState<ThemePreference>(() =>
    parseTheme(readPreference("lime.theme")),
  );
  const [systemDark, setSystemDark] = useState(
    () => matchMedia("(prefers-color-scheme: dark)").matches,
  );
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const update = () => setSystemDark(media.matches);
    const storage = (event: StorageEvent) => {
      if (event.key === "lime.theme" || event.key === null)
        setTheme(parseTheme(readPreference("lime.theme")));
    };
    const local = () => setTheme(parseTheme(readPreference("lime.theme")));
    update();
    media.addEventListener("change", update);
    window.addEventListener("storage", storage);
    window.addEventListener("lime-theme-change", local);
    return () => {
      media.removeEventListener("change", update);
      window.removeEventListener("storage", storage);
      window.removeEventListener("lime-theme-change", local);
    };
  }, []);
  useEffect(() => {
    document.body.classList.toggle("dark", isDark(theme, systemDark));
  }, [theme, systemDark]);
  const changeTheme = (next: ThemePreference) => {
    setTheme(next);
    try {
      localStorage.setItem("lime.theme", next);
      window.dispatchEvent(new Event("lime-theme-change"));
    } catch {
      /* Keep this session usable. */
    }
  };
  return { theme, changeTheme, dark: isDark(theme, systemDark) };
}
export function useAutoLockPreference() {
  const [minutes, setMinutes] = useState<AutoLockMinutes>(() =>
    parseAutoLock(readPreference("lime.autoLock")),
  );
  const changeMinutes = (next: AutoLockMinutes) => {
    setMinutes(next);
    try {
      localStorage.setItem("lime.autoLock", String(next));
    } catch {
      /* Optional preference. */
    }
  };
  return { minutes, changeMinutes };
}
