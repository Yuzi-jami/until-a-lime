import { useEffect, useRef, useState, type FormEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import CsvImportPanel from "./CsvImportPanel";
import ImportPanel from "./ImportPanel";
import type { Entry } from "./model";

export default function DataSettings({
  onImported,
}: {
  onImported: (entries: Entry[]) => void;
}) {
  const [mode, setMode] = useState<"none" | "password" | "import" | "csv">(
      "none",
    ),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const alive = useRef(true),
    running = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const exportBackup = async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const saved = await invoke<boolean>("vault_export");
      if (alive.current)
        setMessage(
          saved
            ? "加密备份已导出。请妥善保存该文件和对应主密码。"
            : "已取消导出。",
        );
    } catch (error) {
      if (alive.current) setError(String(error));
    } finally {
      running.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const changePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (running.current) return;
    const form = event.currentTarget,
      data = new FormData(form);
    const oldPassword = String(data.get("old-password")),
      newPassword = String(data.get("new-password"));
    if (newPassword !== String(data.get("confirm-password"))) {
      setError("两次输入的新主密码不一致。");
      return;
    }
    if (oldPassword === newPassword) {
      setError("新主密码不能与当前主密码相同。");
      return;
    }
    running.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    const pending = invoke("vault_change_password", {
      oldPassword,
      newPassword,
    });
    data.delete("old-password");
    data.delete("new-password");
    data.delete("confirm-password");
    form.reset();
    try {
      await pending;
      if (alive.current) {
        setMode("none");
        setMessage(
          "主密码已修改。下次解锁请使用新主密码；旧备份仍使用旧主密码。",
        );
      }
    } catch (error) {
      if (alive.current) setError(String(error));
    } finally {
      running.current = false;
      if (alive.current) setBusy(false);
    }
  };
  return (
    <section className="data-settings">
      <h3>密码库与备份</h3>
      <div className="data-buttons">
        <button
          className="secondary"
          disabled={busy}
          onClick={() => {
            setMode(mode === "csv" ? "none" : "csv");
            setError("");
            setMessage("");
          }}
        >
          导入浏览器 CSV
        </button>
        <button
          className="secondary"
          disabled={busy}
          onClick={() => void exportBackup()}
        >
          {busy ? "正在处理…" : "导出加密备份"}
        </button>
        <button
          className="secondary"
          disabled={busy}
          onClick={() => {
            setMode(mode === "import" ? "none" : "import");
            setError("");
            setMessage("");
          }}
        >
          导入备份
        </button>
        <button
          className="secondary"
          disabled={busy}
          onClick={() => {
            setMode(mode === "password" ? "none" : "password");
            setError("");
            setMessage("");
          }}
        >
          修改主密码
        </button>
      </div>
      {mode === "password" && (
        <form
          className="data-panel"
          onSubmit={(event) => void changePassword(event)}
        >
          <h3>修改主密码</h3>
          <p>
            当前密码库将使用新主密码重新加密。之前导出及保留的旧备份不会被改写，仍需旧主密码。
          </p>
          <fieldset disabled={busy}>
            <label>
              当前主密码
              <input
                name="old-password"
                type="password"
                required
                maxLength={1024}
                autoComplete="current-password"
              />
            </label>
            <label>
              新主密码
              <input
                name="new-password"
                type="password"
                required
                minLength={12}
                maxLength={1024}
                autoComplete="new-password"
              />
            </label>
            <label>
              再次输入新主密码
              <input
                name="confirm-password"
                type="password"
                required
                minLength={12}
                maxLength={1024}
                autoComplete="new-password"
              />
            </label>
            <button className="primary">
              {busy ? "正在重新加密…" : "验证并修改主密码"}
            </button>
          </fieldset>
        </form>
      )}
      {mode === "csv" && <CsvImportPanel onImported={onImported} />}
      {mode === "import" && (
        <ImportPanel
          onImported={(entries) => {
            onImported(entries);
            setMode("none");
            setMessage("备份账号已追加并加密保存。");
          }}
        />
      )}
      {message && <p role="status">{message}</p>}
      {error && (
        <p className="operation-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
