import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  categoryOptions,
  unresolvedHosts,
  groupingSuggestions,
  type CategoryChange,
  type SaveContext,
} from "./categories";
import CategoryPicker from "./CategoryPicker";
import type { Entry } from "./model";

export default function CategoryOrganizer({
  entries,
  persistent,
  onApply,
  busy,
  onRegroup,
  errorMessage,
}: {
  entries: Entry[];
  persistent: boolean;
  busy: boolean;
  onApply: (
    ids: number[],
    category: string,
    remember?: boolean,
  ) => Promise<boolean>;
  onRegroup?: (
    changes: CategoryChange[],
    remember: boolean,
  ) => Promise<boolean>;
  errorMessage?: string;
}) {
  const [mode, setMode] = useState<"suggested" | "manual">(
    onRegroup ? "suggested" : "manual",
  );
  const [view, setView] = useState<"list" | "help" | "options">("list");
  const [rules, setRules] = useState<Record<string, string>>({});
  const [rulesReady, setRulesReady] = useState(!persistent);
  const [source, setSource] = useState("catalog"),
    [remember, setRemember] = useState(false);
  const [scope, setScope] = useState("all"),
    [query, setQuery] = useState("");
  const [selected, setSelected] = useState<number[]>([]),
    [excluded, setExcluded] = useState<number[]>([]);
  const [category, setCategory] = useState(""),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const [showHosts, setShowHosts] = useState(false),
    [submitting, setSubmitting] = useState(false);
  const pending = useRef(false),
    alive = useRef(true);
  const body = useRef<HTMLDivElement>(null);
  const disabled = busy || submitting;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (!persistent) return;
    let active = true;
    setRulesReady(false);
    void invoke<SaveContext>("quick_save_context")
      .then((value) => {
        if (active) {
          setRules(value.rules);
          setRulesReady(true);
        }
      })
      .catch(() => {
        if (active) setError("网站记忆暂时不可用，可按网站用途整理。");
      });
    return () => {
      active = false;
    };
  }, [entries, persistent]);
  useEffect(() => {
    setSelected([]);
    setExcluded([]);
    setMessage("");
    if (body.current) body.current.scrollTop = 0;
  }, [entries, scope, query, source, mode]);
  const visible = entries.filter(
    (e) =>
      (scope === "all" || `group:${e.category}` === scope) &&
      `${e.name} ${e.user} ${e.url}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const effectiveRules = source === "catalog" ? {} : rules;
  const suggestions = groupingSuggestions(visible, effectiveRules);
  const changes = suggestions.filter((change) => !excluded.includes(change.id));
  const rows =
    mode === "suggested"
      ? visible.filter((e) => suggestions.some((change) => change.id === e.id))
      : visible;
  const count = mode === "suggested" ? changes.length : selected.length;
  const allSelected = rows.length > 0 && count === rows.length;
  const allBox = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (allBox.current)
      allBox.current.indeterminate = count > 0 && !allSelected;
  }, [count, allSelected, view]);
  const apply = async () => {
    if (
      pending.current ||
      !count ||
      disabled ||
      (mode === "suggested" && source === "remembered" && !rulesReady)
    )
      return;
    const clean = category.trim();
    if (mode === "manual" && (!clean || [...clean].length > 24)) {
      setError("请选择分类。");
      return;
    }
    pending.current = true;
    setSubmitting(true);
    setError("");
    setMessage("");
    try {
      const ok =
        mode === "suggested"
          ? await onRegroup?.(changes, remember)
          : await onApply(selected, clean, remember);
      if (ok && alive.current) {
        setSelected([]);
        setExcluded(suggestions.map((c) => c.id));
        setMessage(`已更新 ${count} 个账号`);
      }
    } catch {
      if (alive.current) setError("保存失败，请重试。");
    } finally {
      pending.current = false;
      if (alive.current) setSubmitting(false);
    }
  };
  return (
    <section className="category-organizer organizer-v2">
      <header className="organizer-title">
        <div>
          <span className="eyebrow">YOUR COLLECTION</span>
          <h2>整理分类</h2>
        </div>
        <button
          disabled={disabled}
          className="text-action"
          onClick={() => setView(view === "help" ? "list" : "help")}
        >
          {view === "help" ? "返回列表" : "使用方法"}
        </button>
      </header>
      <fieldset disabled={disabled} className="organizer-shell">
        <div className="organizer-top">
          <div className="organizer-modes" role="group" aria-label="整理方式">
            {onRegroup && (
              <button
                aria-pressed={mode === "suggested"}
                onClick={() => {
                  setMode("suggested");
                  setView("list");
                }}
              >
                按建议整理
              </button>
            )}
            <button
              aria-pressed={mode === "manual"}
              onClick={() => {
                setMode("manual");
                setView("list");
              }}
            >
              手动分组
            </button>
          </div>
          <div className="organizer-tools">
            <input
              type="search"
              aria-label="筛选待分类账号"
              placeholder="搜索网站或账号"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <select
              aria-label="整理范围"
              value={scope}
              onChange={(e) => setScope(e.target.value)}
            >
              <option value="all">全部账号</option>
              {categoryOptions(entries).map((c) => (
                <option key={c} value={`group:${c}`}>
                  {c}
                </option>
              ))}
            </select>
            <button
              className="text-action"
              aria-expanded={view === "options"}
              onClick={() => setView(view === "options" ? "list" : "options")}
            >
              {view === "options" ? "返回列表" : "更多"}
            </button>
          </div>
        </div>
        <div className="organizer-body" ref={body}>
          {view === "help" ? (
            <div className="organizer-guide">
              <h3>两种整理方式</h3>
              <p>
                <b>按建议整理</b>
                ：只展示需要调整的账号，右侧可对照原分类与建议分类。取消勾选不想修改的记录，再应用。
              </p>
              <p>
                <b>手动分组</b>
                ：勾选账号，在底部选择目标分类，一次移动多条记录。
              </p>
              <p>
                分类不确定或已经合适的账号不会出现在建议列表。可以切到手动分组查看。
              </p>
              <h3>网站记忆</h3>
              <p>
                “更多”里可以选择使用已记住的规则，或记住本次分类。默认按网站用途建议，不自动记住批量操作。
              </p>
              <p>
                纠正分类时，与原分类一致的旧网站记忆会被移除，避免继续误分。
              </p>
            </div>
          ) : view === "options" ? (
            <div className="organizer-guide">
              <h3>整理选项</h3>
              {onRegroup && (
                <label className="grouping-source">
                  建议来源
                  <select
                    aria-label="分组建议来源"
                    value={source}
                    onChange={(e) => setSource(e.target.value)}
                  >
                    <option value="catalog">按网站用途</option>
                    <option value="remembered" disabled={!rulesReady}>
                      优先使用网站记忆
                    </option>
                  </select>
                </label>
              )}
              <label className="organizer-select">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                />
                记住本次网站分类
              </label>
              <button
                className="text-action"
                onClick={() => setShowHosts((value) => !value)}
              >
                {showHosts ? "收起待识别域名" : "查看待识别域名"}
              </button>
              {showHosts && (
                <label className="unresolved-hosts">
                  仅域名，不含账号与密码
                  <textarea
                    aria-label="待识别域名"
                    readOnly
                    value={unresolvedHosts(visible, effectiveRules).join("\n")}
                    placeholder="当前范围没有待识别域名"
                  />
                </label>
              )}
            </div>
          ) : (
            <>
              <div className="organizer-list-heading">
                <label>
                  <input
                    ref={allBox}
                    type="checkbox"
                    aria-label="全选当前列表"
                    checked={allSelected}
                    disabled={!rows.length}
                    onChange={(e) =>
                      mode === "suggested"
                        ? setExcluded(
                            e.target.checked
                              ? []
                              : suggestions.map((c) => c.id),
                          )
                        : setSelected(
                            e.target.checked ? rows.map((e) => e.id) : [],
                          )
                    }
                  />
                  {mode === "suggested"
                    ? `可调整 ${rows.length} 项`
                    : `${rows.length} 个账号`}
                </label>
                <span>{mode === "suggested" ? "当前 → 建议" : "当前分类"}</span>
              </div>
              {rows.map((entry) => {
                const change = suggestions.find((c) => c.id === entry.id);
                const checked =
                  mode === "suggested"
                    ? !excluded.includes(entry.id)
                    : selected.includes(entry.id);
                return (
                  <label key={entry.id} className="organizer-row">
                    <input
                      type="checkbox"
                      aria-label={`选择 ${entry.name} ${entry.user || "未填写用户名"}`}
                      checked={checked}
                      onChange={(e) => {
                        if (mode === "suggested")
                          setExcluded((ids) =>
                            e.target.checked
                              ? ids.filter((id) => id !== entry.id)
                              : [...ids, entry.id],
                          );
                        else
                          setSelected((ids) =>
                            e.target.checked
                              ? [...ids, entry.id]
                              : ids.filter((id) => id !== entry.id),
                          );
                      }}
                    />
                    <span>
                      <b>{entry.name}</b>
                      <small>{entry.user || "未填写用户名"}</small>
                    </span>
                    <span className="organizer-change">
                      {mode === "suggested" && change ? (
                        <>
                          <span>{entry.category}</span>
                          <i>→</i>
                          <b>{change.category}</b>
                        </>
                      ) : (
                        <b>{entry.category}</b>
                      )}
                    </span>
                  </label>
                );
              })}
              {!rows.length && (
                <div className="organizer-empty">
                  <span aria-hidden="true">◌</span>
                  <h3>
                    {mode === "suggested"
                      ? "暂时没有需要调整的分类"
                      : "没有找到账号"}
                  </h3>
                  <p>
                    {mode === "suggested"
                      ? "可以切换到手动分组。"
                      : "试试其他关键词或分类。"}
                  </p>
                </div>
              )}
            </>
          )}
        </div>
        <footer className="organizer-footer">
          {(errorMessage || error) && (
            <p role="alert">{errorMessage || error}</p>
          )}
          {message && <p role="status">{message}</p>}
          <div className="organizer-footer-actions">
            <span>已选 {count} 项</span>
            {mode === "manual" && (
              <CategoryPicker
                label="移至分类"
                value={category}
                onChange={setCategory}
                options={categoryOptions(entries)}
              />
            )}
            {view !== "list" ? (
              <button className="primary" onClick={() => setView("list")}>
                返回列表
              </button>
            ) : (
              <button
                className="primary"
                disabled={
                  !count ||
                  (mode === "manual" && !category.trim()) ||
                  (mode === "suggested" &&
                    source === "remembered" &&
                    !rulesReady)
                }
                onClick={() => void apply()}
              >
                {disabled
                  ? "正在保存…"
                  : mode === "suggested"
                    ? `应用 ${count} 项建议`
                    : "移动所选"}
              </button>
            )}
          </div>
        </footer>
      </fieldset>
    </section>
  );
}
