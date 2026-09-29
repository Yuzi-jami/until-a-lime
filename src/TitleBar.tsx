import { useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

export default function TitleBar() {
  const [error, setError] = useState("");
  const native = isTauri();
  async function control(action: "close" | "minimize" | "toggleMaximize") {
    try {
      await getCurrentWindow()[action]();
      setError("");
    } catch {
      setError("窗口操作未完成，请重试。");
    }
  }
  return (
    <header className="window-bar" data-tauri-drag-region>
      <div className="window-controls" aria-label="窗口控制">
        {(
          [
            ["close", "关闭窗口，收起到托盘", "×"],
            ["minimize", "最小化窗口", "−"],
            ["toggleMaximize", "最大化或还原窗口", "+"],
          ] as const
        ).map(([action, label, symbol]) => (
          <button
            key={action}
            className={`window-dot ${action}`}
            aria-label={native ? label : `${label}（仅桌面版）`}
            title={native ? label : "浏览器预览"}
            disabled={!native}
            onClick={() => void control(action)}
          >
            <span aria-hidden="true">{symbol}</span>
          </button>
        ))}
      </div>
      <span className="window-name" data-tauri-drag-region>
        直到密码变成一颗酸橙
      </span>
      <span className="window-caption" data-tauri-drag-region>
        {native ? "PRIVATE COLLECTION" : "DESIGN PREVIEW"}
      </span>
      {error && (
        <span className="window-error" role="status">
          {error}
        </span>
      )}
    </header>
  );
}
