export type ThemePreference = "light" | "dark" | "system";
export type AutoLockMinutes = 0 | 1 | 5 | 15;
export function parseTheme(value: string | null): ThemePreference {
  return value === "light" || value === "dark" ? value : "system";
}
export function parseAutoLock(value: string | null): AutoLockMinutes {
  return value === "0" ? 0 : value === "1" ? 1 : value === "15" ? 15 : 5;
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
