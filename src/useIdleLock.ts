import { useEffect } from "react";
import { idleExpired, type AutoLockMinutes } from "./preferences";

export function useIdleLock(
  minutes: AutoLockMinutes,
  locked: boolean,
  onLock: () => void,
) {
  useEffect(() => {
    if (locked || minutes === 0) return;
    let lastActivity = Date.now(),
      expired = false;
    const check = () => {
      if (expired) return true;
      if (idleExpired(lastActivity, Date.now(), minutes)) {
        expired = true;
        onLock();
        return true;
      }
      return false;
    };
    const activity = (event: Event) => {
      if (check()) {
        // An overdue click after sleep must not activate a control or unlock.
        if (event.cancelable) event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      lastActivity = Date.now();
    };
    const events = ["pointerdown", "pointermove", "keydown", "wheel"];
    events.forEach((name) =>
      window.addEventListener(name, activity, { capture: true }),
    );
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    const timer = setInterval(check, 1000);
    return () => {
      clearInterval(timer);
      events.forEach((name) =>
        window.removeEventListener(name, activity, true),
      );
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [minutes, locked, onLock]);
}
