export type ThemePreference = "light" | "dark" | "system";
export type AutoLockMinutes = number;
export type FontScale = number;
export const MAX_AUTO_LOCK_MINUTES = 1440;
export const MIN_FONT_SCALE = 0.9;
export const MAX_FONT_SCALE = 1.3;
export function parseTheme(value: string | null): ThemePreference {
  return value === "light" || value === "dark" ? value : "system";
}
export function parseAutoLock(value: string | null): AutoLockMinutes {
  if (value === null || !/^\d+$/.test(value)) return 5;
  const minutes = Number(value);
  return Number.isInteger(minutes) &&
    minutes >= 0 &&
    minutes <= MAX_AUTO_LOCK_MINUTES
    ? minutes
    : 5;
}
export function parseFontScale(value: string | null): FontScale {
  if (value === null || !/^\d+(?:\.\d+)?$/.test(value)) return 1;
  const scale = Number(value);
  return Number.isFinite(scale) && scale >= MIN_FONT_SCALE && scale <= MAX_FONT_SCALE
    ? Math.round(scale * 20) / 20
    : 1;
}
export function isDark(theme: ThemePreference, systemDark: boolean): boolean {
  return theme === "dark" || (theme === "system" && systemDark);
}
export function idleExpired(
  lastActivity: number,
  now: number,
  minutes: AutoLockMinutes,
): boolean {
  return (
    minutes !== 0 &&
    (now < lastActivity || now - lastActivity >= minutes * 60000)
  );
}
