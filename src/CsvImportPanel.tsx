import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Entry } from "./model";

type Preview = { ticket: string; name: string; added: number; skipped: number };
export default function CsvImportPanel({
  onImported,
}: {
  onImported: (entries: Entry[]) => void;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const alive = useRef(true),
    running = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      void invoke("vault_cancel_csv").catch(() => {});
    };
  }, []);
  async function choose() {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    setPreview(null);
    setMessage("");
    try {
      await invoke("vault_cancel_csv");
      const value = await invoke<Preview | null>("vault_choose_csv");
      if (alive.current) setPreview(value);
      else await invoke("vault_cancel_csv");
    } catch (e) {
      if (alive.current) setError(String(e));
    } finally {
      running.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function commit() {
    if (!preview || running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await invoke<{
        entries: Entry[];
        added: number;
        skipped: number;
      }>("vault_commit_csv", { ticket: preview.ticket });
      if (alive.current) {
        setPreview(null);
        setMessage(
          `已加密保存 ${result.added} 条，跳过 ${result.skipped} 条完全相同的账号。`,
        );
        onImported(result.entries);
      }
    } catch (e) {
      if (alive.current) {
        setError(String(e));
        setPreview(null);
      }
    } finally {
      running.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return (
    <section className="data-panel">
      <h3>从 Edge / Chrome 导入</h3>
      <p>
        在浏览器密码管理器中导出密码，选择导出的
        CSV。先检查条数，再追加到收藏室；相同网址、用户名和密码会跳过，不覆盖已有记录。
      </p>
      <p>CSV 内含明文密码。导入成功后请自行安全保管或删除导出文件。</p>
      <button
        disabled={busy}
        className="secondary"
        onClick={() => void choose()}
      >
        {busy ? "正在处理…" : "选择浏览器 CSV"}
      </button>
      {preview && (
        <div className="import-preview">
          <p className="selected-file">{preview.name}</p>
          <p>
            将新增 <strong>{preview.added}</strong> 条，跳过{" "}
            <strong>{preview.skipped}</strong> 条重复记录。
          </p>
          <button
            className="primary"
            disabled={busy}
            onClick={() => void commit()}
          >
            确认导入并加密保存
          </button>
          <button
            className="secondary"
            disabled={busy}
            onClick={() => {
              setPreview(null);
              void invoke("vault_cancel_csv").catch((e) => setError(String(e)));
            }}
          >
            取消导入
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="operation-error">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
