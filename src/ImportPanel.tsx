import { useEffect, useRef, useState, type FormEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Entry } from "./model";

export default function ImportPanel({
  newVault = false,
  onImported,
}: {
  newVault?: boolean;
  onImported: (entries: Entry[]) => void;
}) {
  const [file, setFile] = useState<{ ticket: string; name: string } | null>(
      null,
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const alive = useRef(true),
    running = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const choose = async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    try {
      const selected = await invoke<{ ticket: string; name: string } | null>(
        "vault_choose_import",
      );
      if (alive.current && selected) setFile(selected);
    } catch (error) {
      if (alive.current) setError(String(error));
    } finally {
      running.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!file || running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    const form = event.currentTarget,
      data = new FormData(form);
    const pending = invoke<Entry[]>("vault_import", {
      ticket: file.ticket,
      password: String(data.get("backup-password") ?? ""),
    });
    data.delete("backup-password");
    form.reset();
    try {
      const entries = await pending;
      if (alive.current) {
        setFile(null);
        onImported(entries);
      }
    } catch (error) {
      if (alive.current) setError(String(error));
    } finally {
      running.current = false;
      if (alive.current) setBusy(false);
    }
  };
  return (
    <section className="data-panel">
      <h3>导入加密备份</h3>
      <p>
        {newVault
          ? "从备份建立本机密码库，之后使用这份备份的主密码解锁。"
          : "将备份中的账号追加到当前收藏室，保留现有账号；同名账号也会保留为独立记录。"}
      </p>
      <button
        className="secondary"
        disabled={busy}
        onClick={() => void choose()}
      >
        {file ? "重新选择备份" : "选择 .lime / .bak 文件"}
      </button>
      {file && (
        <form onSubmit={(event) => void submit(event)}>
          <fieldset disabled={busy}>
            <p className="selected-file">{file.name}</p>
            <label>
              备份的主密码
              <input
                name="backup-password"
                type="password"
                required
                maxLength={1024}
                autoComplete="off"
              />
            </label>
            <button className="primary">
              {busy
                ? "正在验证并导入…"
                : newVault
                  ? "验证并创建密码库"
                  : "验证并追加账号"}
            </button>
          </fieldset>
        </form>
      )}
      {error && (
        <p className="operation-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
