import { useEffect, useRef, useState, type FormEvent } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import App from "./App";
import { OrangeMark } from "./components";
import { useTheme } from "./usePreferences";
import type { Entry } from "./model";
import ImportPanel from "./ImportPanel";

export default function VaultRoot() {
  const [entries, setEntries] = useState<Entry[] | null>(null),
    [exists, setExists] = useState<boolean | null>(null);
  const [backup, setBackup] = useState(false),
    [restore, setRestore] = useState(false);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [ready, setReady] = useState(false);
  const epoch = useRef(0);
  useTheme();
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false,
      cleanup: (() => void) | undefined;
    const status = () =>
      invoke<{ exists: boolean; backup: boolean }>("vault_status").then(
        (value) => {
          if (!disposed) {
            setExists(value.exists);
            setBackup(value.backup);
          }
        },
      );
    listen<string>("lime-action", (event) => {
      if (event.payload === "lock") {
        epoch.current++;
        setEntries(null);
        setError("");
        void status().catch(() => setError("无法读取密码库状态，请重试。"));
      }
    })
      .then(async (unlisten) => {
        if (disposed) {
          unlisten();
          return;
        }
        cleanup = unlisten;
        await invoke("vault_lock");
        await status();
        if (!disposed) {
          setReady(true);
          await invoke("show_floating");
        }
      })
      .catch(() => {
        if (!disposed) setError("密码库服务连接失败，请重新启动应用。");
      });
    return () => {
      disposed = true;
      epoch.current++;
      cleanup?.();
    };
  }, []);
  if (!isTauri()) return <App />;
  const lock = () => {
    epoch.current++;
    setEntries(null);
    void invoke("vault_lock").catch(() =>
      setError("锁定请求失败，请退出应用。"),
    );
  };
  if (entries)
    return <App initialEntries={entries} persistent onVaultLock={lock} />;
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || !ready || exists === null) return;
    const form = event.currentTarget,
      data = new FormData(form);
    let password = String(data.get("master") ?? "");
    if (!exists && !restore && password !== String(data.get("confirm") ?? "")) {
      setError("两次输入的主密码不一致。");
      return;
    }
    const request = epoch.current;
    setBusy(true);
    setError("");
    const pending = invoke<Entry[]>("vault_auth", {
      password,
      create: !exists && !restore,
      restore,
    });
    password = "";
    data.delete("master");
    data.delete("confirm");
    form.reset();
    try {
      const result = await pending;
      if (epoch.current === request) {
        setExists(true);
        setRestore(false);
        setEntries(result);
      }
    } catch (error) {
      if (epoch.current === request)
        setError(typeof error === "string" ? error : "操作失败，请重试。");
      const status = await invoke<{ exists: boolean; backup: boolean }>(
        "vault_status",
      ).catch(() => null);
      if (status) setExists(status.exists);
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="vault-gate">
      <section className="vault-gate-card">
        <OrangeMark />
        <div className="eyebrow">UNTIL / A LIME · 本地密码库</div>
        <h1>
          {restore
            ? "找回上次的收藏。"
            : exists === false
              ? "给秘密一个家。"
              : "秘密，暂时合上。"}
        </h1>
        <p>
          {restore
            ? "验证主密码后恢复上一次保存的加密备份。当前文件会另存，最近一次修改可能不在备份中。"
            : exists === false
              ? "设置主密码，创建属于你的加密收藏室。"
              : "输入主密码，打开你的收藏室。"}
        </p>
        <form onSubmit={(event) => void submit(event)}>
          <fieldset disabled={busy || !ready || exists === null}>
            <label>
              主密码
              <input
                name="master"
                type="password"
                autoFocus
                required
                minLength={exists || restore ? 1 : 12}
                maxLength={1024}
                autoComplete={exists ? "current-password" : "new-password"}
                placeholder={
                  exists ? "输入主密码" : "至少 12 个字符，建议使用长口令"
                }
              />
            </label>
            {exists === false && !restore && (
              <>
                <label>
                  再次输入
                  <input
                    name="confirm"
                    type="password"
                    required
                    maxLength={1024}
                    autoComplete="new-password"
                  />
                </label>
                <p>
                  主密码不会保存，忘记后无法恢复。请先用测试账号体验此开发版本。
                </p>
              </>
            )}
            <button className="primary">
              {busy
                ? "正在处理…"
                : restore
                  ? "验证主密码并恢复 ↗"
                  : exists === false
                    ? "创建密码库 ↗"
                    : "解锁收藏室 ↗"}
            </button>
          </fieldset>
        </form>
        {exists === false && ready && !busy && (
          <ImportPanel
            newVault
            onImported={(updated) => {
              setExists(true);
              setEntries(updated);
              setRestore(false);
            }}
          />
        )}
        {backup && (
          <button
            className="gate-recover"
            disabled={busy}
            onClick={() => {
              setRestore((value) => !value);
              setError("");
            }}
          >
            {restore ? "返回正常解锁" : "从上次加密备份恢复"}
          </button>
        )}
        {error && (
          <p role="alert" className="gate-error">
            {error}
          </p>
        )}
        <small>账号内容加密保存在本机 · 无云端同步</small>
      </section>
    </main>
  );
}
