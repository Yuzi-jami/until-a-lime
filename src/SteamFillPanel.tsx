import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export default function SteamFillPanel({ id }: { id: number }) {
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  useEffect(() => {
    let disposed = false,
      stop: (() => void) | undefined;
    generation.current++;
    setPending(false);
    setMessage("");
    void listen<string>("lime-steam-fill", ({ payload }) => {
      if (!disposed) {
        setMessage(payload);
        setPending(false);
      }
    })
      .then((fn) => {
        if (disposed) fn();
        else stop = fn;
      })
      .catch(() => setMessage("填写状态通知不可用，请重新打开收藏室。"));
    return () => {
      disposed = true;
      generation.current++;
      stop?.();
      void invoke("steam_fill_cancel").catch(() => {});
    };
  }, [id]);
  async function arm(field: "user" | "password") {
    const request = generation.current;
    setBusy(true);
    setMessage("");
    try {
      await invoke("steam_fill_arm", { id, field });
      if (request === generation.current) {
        setPending(true);
        setMessage(
          `已准备${field === "user" ? "用户名" : "密码"}。30 秒内切换到 Steam，点击对应输入框，按 Ctrl + Alt + P 并松开。Esc 取消。`,
        );
      }
    } catch (e) {
      if (request === generation.current) setMessage(String(e));
    } finally {
      if (request === generation.current) setBusy(false);
    }
  }
  return (
    <section className="data-panel">
      <h3>填写到 Steam（试用）</h3>
      <p>
        选择一个字段，切换到普通权限的 Steam 并点击正确输入框，再按 Ctrl + Alt +
        P。只粘贴该字段，不自动 Tab 或登录。
      </p>
      <p>
        此方式经过剪贴板；无法识别 Steam 内部具体字段，请核对焦点。真实 Steam
        兼容性尚待验证。
      </p>
      <div className="data-buttons">
        <button
          className="secondary"
          disabled={busy || pending}
          onClick={() => void arm("user")}
        >
          准备填写用户名
        </button>
        <button
          className="secondary"
          disabled={busy || pending}
          onClick={() => void arm("password")}
        >
          准备填写密码
        </button>
        {pending && (
          <button
            className="secondary"
            onClick={() => {
              void invoke("steam_fill_cancel").then(
                () => {
                  setPending(false);
                  setMessage("已取消。");
                },
                (e) => setMessage(String(e)),
              );
            }}
          >
            取消填写
          </button>
        )}
      </div>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
