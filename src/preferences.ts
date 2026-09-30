export type ThemePreference = "light" | "dark" | "system";
export type AutoLockMinutes = number;
export const MAX_AUTO_LOCK_MINUTES = 1440;
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
