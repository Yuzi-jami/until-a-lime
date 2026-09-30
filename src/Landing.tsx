import { useEffect, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Modal } from "./components";
import Generator from "./GeneratorPanel";
import { useTheme } from "./usePreferences";

// Functional entry screen only. Visual design awaits the user's design files.
export default function Landing({
  onAccess,
  ready,
  error,
}: {
  onAccess: () => void;
  ready: boolean;
  error: string;
}) {
  const [panel, setPanel] = useState<"generate" | null>(null);
  useTheme();
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false,
      stop: (() => void) | undefined;
    void listen<string>("lime-action", ({ payload }) => {
      if (payload === "generate") setPanel("generate");
      if (payload === "search" || payload === "vault") {
        setPanel(null);
        onAccess();
      }
    })
      .then((cleanup) => {
        if (disposed) cleanup();
        else stop = cleanup;
      })
      .catch(() => {});
    return () => {
      disposed = true;
      stop?.();
    };
  }, [onAccess]);
  return (
    <main className="vault-gate">
      <section className="vault-gate-card">
        <h1>收藏室</h1>
        <p>打开软件无需主密码。使用密码库时验证一次，有效会话内不重复验证。</p>
        <button className="primary" disabled={!ready} onClick={onAccess}>
          打开密码收藏室
        </button>
        {error && (
          <p role="alert" className="operation-error">
            {error}
          </p>
        )}
        {panel && (
          <Modal title="密码生成器" onClose={() => setPanel(null)}>
            <Generator />
          </Modal>
        )}
      </section>
    </main>
  );
}
