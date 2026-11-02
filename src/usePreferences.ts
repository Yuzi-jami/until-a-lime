import { useEffect, useState } from "react";
import {
  isDark,
  parseAutoLock,
  parseTheme,
  parseFontScale,
  type AutoLockMinutes,
  type FontScale,
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

export function useFontScalePreference() {
  const [fontScale, setFontScale] = useState<FontScale>(() =>
    parseFontScale(readPreference("lime.fontScale")),
  );
  useEffect(() => {
    document.body.style.setProperty("--lime-font-scale", String(fontScale));
    const elements = Array.from(document.body.querySelectorAll<HTMLElement>("*"));
    const originals = new Map<HTMLElement, string>();
    const apply = (element: HTMLElement) => {
      if (originals.has(element)) return;
      const computed = getComputedStyle(element).fontSize;
      if (!computed.endsWith("px")) return;
      originals.set(element, element.style.fontSize);
      const base = Number.parseFloat(computed);
      if (Number.isFinite(base)) element.style.fontSize = `${base * fontScale}px`;
    };
    for (const element of elements) apply(element);
    const observer = new MutationObserver(() => {
      for (const element of Array.from(document.body.querySelectorAll<HTMLElement>("*"))) apply(element);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      for (const [element, value] of originals) element.style.fontSize = value;
      document.body.style.removeProperty("--lime-font-scale");
    };
  }, [fontScale]);
  const changeFontScale = (next: FontScale) => {
    const normalized = Math.min(1.3, Math.max(0.9, Math.round(next * 20) / 20));
    setFontScale(normalized);
    try {
      localStorage.setItem("lime.fontScale", String(normalized));
    } catch {
      /* Keep this session usable. */
    }
  };
  return { fontScale, changeFontScale };
}

export function useProfileNamePreference() {
  const [profileName, setProfileName] = useState(() => readPreference("lime.profileName") || "一位酸橙收藏家");
  const changeProfileName = (next: string) => {
    const normalized = next.trim().slice(0, 32) || "一位酸橙收藏家";
    setProfileName(normalized);
    try {
      localStorage.setItem("lime.profileName", normalized);
    } catch {
      /* Keep this session usable. */
    }
  };
  return { profileName, changeProfileName };
}

export function useProfileSubtitlePreference(defaultValue: string) {
  const [profileSubtitle, setProfileSubtitle] = useState(() =>
    readPreference("lime.profileSubtitle") || defaultValue,
  );
  const changeProfileSubtitle = (next: string) => {
    const normalized = next.trim().slice(0, 48) || defaultValue;
    setProfileSubtitle(normalized);
    try {
      localStorage.setItem("lime.profileSubtitle", normalized);
    } catch {
      /* Keep this session usable. */
    }
  };
  return { profileSubtitle, changeProfileSubtitle };
}

export function useSidebarWidthPreference() {
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const value = Number(readPreference("lime.sidebarWidth"));
    return Number.isFinite(value) && value >= 180 && value <= 360 ? value : 224;
  });
  const changeSidebarWidth = (next: number) => {
    const normalized = Math.round(Math.min(360, Math.max(180, next)));
    setSidebarWidth(normalized);
    try {
      localStorage.setItem("lime.sidebarWidth", String(normalized));
    } catch {
      /* Keep this session usable. */
    }
  };
  return { sidebarWidth, changeSidebarWidth };
}
