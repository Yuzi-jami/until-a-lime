import { useTheme } from "./usePreferences";
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Wheel, type WheelAction } from "./components";

export default function Floating() {
  useTheme();
  const [error, setError] = useState("");
  const resizeQueue = useRef<Promise<unknown>>(Promise.resolve());
  const resize = useCallback((expanded: boolean) => {
    // Serialize hover transitions so a late response cannot leave the wrong size.
    resizeQueue.current = resizeQueue.current
      .then(() => invoke("resize_floating", { expanded }))
      .catch(() => setError("轮盘尺寸调整失败，可从托盘重新打开。"));
  }, []);
  useEffect(() => {
    document.documentElement.classList.add("floating-document");

    return () => {
      document.documentElement.classList.remove("floating-document");
    };
  }, []);
  const action = (value: WheelAction) => {
    setError("");
    invoke("desktop_action", { action: value }).catch(() =>
      setError("未能打开收藏室，请使用托盘重试。"),
    );
  };
  const drag = async () => {
    setError("");
    await resizeQueue.current;
    try {
      await invoke("drag_floating");
    } catch {
      setError("拖动失败，请重试。");
    }
  };
  return (
    <div className="floating-surface">
      <Wheel
        onAction={action}
        onOpenChange={resize}
        onDrag={drag}
        dismissOnWindowBlur
      />
      {error && (
        <p className="float-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
