import { useEffect, useRef, useState, type FormEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import Generator from "./GeneratorPanel";
import CategoryPicker from "./CategoryPicker";
import {
  categoryOptions,
  siteDetails,
  siteKey,
  suggestCategory,
  type SaveContext,
} from "./categories";
import type { Entry } from "./model";
import "./quick-save.css";

export default function QuickSave({
  context,
  onClose,
  onSaved,
  persistent = true,
}: {
  context: SaveContext;
  onClose: () => void;
  onSaved: (entry?: Entry) => void;
  persistent?: boolean;
}) {
  const [site, setSite] = useState(""),
    [user, setUser] = useState(""),
    [password, setPassword] = useState("");
  const [category, setCategory] = useState(""),
    [name, setName] = useState(""),
    [note, setNote] = useState("");
  const [generate, setGenerate] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [choice, setChoice] = useState("");
  const alive = useRef(true),
    pending = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const suggested = suggestCategory(site, name || site, context.rules);
  const matches = context.entries.filter(
    (e) => siteKey(e.url) === siteKey(site) && e.user === user,
  );
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending.current) return;
    setError("");
    try {
      const details = siteDetails(site);
      if (!password) throw new Error("请输入或生成密码。");
      if (matches.length && !choice)
        throw new Error("请选择更新已有密码或另存账号。");
      const entry: Entry = {
        id: 0,
        name: name.trim() || details.name,
        url: details.url,
        user,
        category: category.trim() || "未分类",
        note,
        favorite: false,
        icon: "L",
      };
      if (!entry.category || entry.category.length > 24)
        throw new Error("分类需要 1–24 个字符。");
      pending.current = true;
      setBusy(true);
      if (persistent)
        await invoke("quick_save_account", {
          entry,
          password,
          epoch: context.epoch,
          updateId: choice && choice !== "new" ? Number(choice) : null,
          separate: choice === "new",
        });
      if (alive.current) {
        setPassword("");
        onSaved(
          !persistent && choice && choice !== "new"
            ? matches.find((e) => e.id === Number(choice))
            : entry,
        );
      }
    } catch (e) {
      if (alive.current)
        setError(
          typeof e === "string"
            ? e
            : e instanceof Error
              ? e.message
              : "保存失败，请重试。",
        );
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  };
  return (
    <section className="quick-save" aria-label="快速保存账号">
      <header>
        <div>
          <span className="eyebrow">A LITTLE SECRET</span>
          <h2>{generate ? "生成密码" : "保存账号"}</h2>
        </div>
        <button
          type="button"
          disabled={busy}
          aria-label={generate ? "返回保存账号" : "关闭快速保存"}
          onClick={() => (generate ? setGenerate(false) : onClose())}
        >
          ×
        </button>
      </header>
      {generate ? (
        <Generator
          onUse={(value) => {
            setPassword(value);
            setGenerate(false);
          }}
        />
      ) : (
        <form onSubmit={(event) => void submit(event)}>
          <fieldset disabled={busy}>
            <label>
              网站 / 应用
              <input
                autoFocus
                required
                maxLength={8192}
                placeholder="网址或应用名称"
                value={site}
                onChange={(e) => {
                  setSite(e.target.value);
                  setChoice("");
                }}
              />
            </label>
            <label>
              账号
              <input
                maxLength={1024}
                placeholder="用户名、邮箱或手机号，可留空"
                autoComplete="off"
                value={user}
                onChange={(e) => {
                  setUser(e.target.value);
                  setChoice("");
                }}
              />
            </label>
            <label>
              密码
              <div className="quick-secret">
                <input
                  required
                  type="password"
                  maxLength={1024}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button type="button" onClick={() => setGenerate(true)}>
                  生成
                </button>
              </div>
            </label>
            <CategoryPicker
              value={category}
              onChange={setCategory}
              options={categoryOptions(context.entries)}
              optional
            />
            {!category && suggested !== "未分类" && (
              <button
                type="button"
                className="category-suggestion"
                onClick={() => setCategory(suggested)}
              >
                使用建议：{suggested}
              </button>
            )}
            <details>
              <summary>更多选项</summary>
              <label>
                名称
                <input
                  maxLength={8192}
                  placeholder="默认从网站或应用名称生成"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label>
                便笺
                <textarea
                  maxLength={16384}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>
            </details>
            {matches.length > 0 && (
              <label className="quick-duplicate">
                已有相同网站和账号
                <select
                  required
                  value={choice}
                  onChange={(e) => setChoice(e.target.value)}
                >
                  <option value="">选择保存方式</option>
                  {matches.map((e) => (
                    <option key={e.id} value={e.id}>
                      更新「{e.name}」的密码 · #{e.id}
                    </option>
                  ))}
                  <option value="new">另存一个账号</option>
                </select>
                <small>更新仅替换密码，保留已有分类和便笺。</small>
              </label>
            )}
            {error && <p role="alert">{error}</p>}
            <button className="primary" type="submit">
              {busy ? "正在保存…" : persistent ? "加密保存" : "保存演示记录"}
            </button>
            <details className="inline-guide">
              <summary>使用方法</summary>
              <p>分类可留空，保存后归入“未分类”。选择“新分类”可自行命名。</p>
              <p>
                点“生成”可创建并复制密码。切回网站时草稿保留，关闭小窗或锁定后清除；注册成功后再保存。
              </p>
              {!persistent && <p>演示模式仅保存本次会话的虚构资料。</p>}
            </details>
          </fieldset>
        </form>
      )}
    </section>
  );
}
