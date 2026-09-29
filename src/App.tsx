import BrowserSetup from "./BrowserSetup";
import PasswordStatistics, {
  OrangeStrength,
  type Strength,
} from "./VaultInsights";
import SteamFillPanel from "./SteamFillPanel";
import SettingsPanel from "./SettingsPanel";
import { useTheme, useAutoLockPreference } from "./usePreferences";
import { useIdleLock } from "./useIdleLock";
import {
  restoreEntry,
  restoreRecent,
  type DeletedEntry,
} from "./entry-actions";
import Generator from "./GeneratorPanel";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { isTauri, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  AccountRow,
  Modal,
  OrangeMark,
  Wheel,
  type WheelAction,
} from "./components";
import {
  demoEntries,
  navigation,
  type Category,
  type Entry,
  type Filter,
} from "./model";
type DialogState =
  | { kind: "search" | "generate" | "help" | "settings" }
  | { kind: "edit"; entry?: Entry }
  | { kind: "delete"; entry: Entry }
  | null;

export default function App({
  initialEntries = demoEntries,
  persistent = false,
  onVaultLock,
}: {
  initialEntries?: Entry[];
  persistent?: boolean;
  onVaultLock?: () => void;
} = {}) {
  const [page, setPage] = useState<
    "vault" | "browser" | "statistics" | "settings"
  >("vault");
  const [strengths, setStrengths] = useState<Strength[]>([]);
  const [strengthPending, setStrengthPending] = useState(false);
  const [strengthError, setStrengthError] = useState("");
  const [entries, setEntries] = useState<Entry[]>(initialEntries),
    [selected, setSelected] = useState(1),
    [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState(""),
    [sort, setSort] = useState("default"),
    [recent, setRecent] = useState([1, 2, 4]);
  const [dialog, setDialog] = useState<DialogState>(null),
    [locked, setLocked] = useState(false),
    [shown, setShown] = useState(false),
    [toast, setToast] = useState("");
  const { theme, changeTheme, dark } = useTheme();
  const { minutes, changeMinutes } = useAutoLockPreference();
  const [secret, setSecret] = useState(""),
    [saving, setSaving] = useState(false),
    [operationError, setOperationError] = useState("");
  const secretRequest = useRef(0),
    mutation = useRef(false),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      secretRequest.current++;
    };
  }, []);
  const [runtime, setRuntime] = useState(
    isTauri() ? "桌面连接中" : "浏览器预览",
  );
  const searchRef = useRef<HTMLInputElement>(null);
  const nextId = useRef(
    Math.max(0, ...initialEntries.map((entry) => entry.id)) + 1,
  );
  const [deleted, setDeleted] = useState<DeletedEntry | null>(null);
  useEffect(() => {
    if (!deleted) return;
    const timer = setTimeout(() => setDeleted(null), 10000);
    return () => clearTimeout(timer);
  }, [deleted]);
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let cleanup: (() => void) | undefined;
    listen<WheelAction>("lime-action", (event) => {
      if (event.payload === "lock") {
        setShown(false);
        setDialog(null);
        setToast("");
        setDeleted(null);
        setLocked(true);
        lockedRef.current = true;
        return;
      }
      if (lockedRef.current) return;
      if (event.payload === "search" || event.payload === "generate")
        setDialog({ kind: event.payload });
      if (event.payload === "vault") {
        setPage("vault");
        setDialog(null);
        setFilter("all");
        setQuery("");
      }
    })
      .then((unlisten) => {
        if (disposed) {
          unlisten();
          return;
        }
        cleanup = unlisten;
        return invoke("show_floating");
      })
      .catch(() => {
        if (!disposed) setToast("桌面轮盘连接失败，可从托盘重新打开");
      });
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);
  useEffect(() => {
    let active = true;
    if (isTauri())
      invoke<string>("runtime_status")
        .then((value) => {
          if (active) setRuntime(value);
        })
        .catch(() => {
          if (active) setRuntime("桌面连接不可用");
        });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!persistent) return;
    let disposed = false,
      cleanup: (() => void) | undefined;
    listen("lime-vault-changed", () => {
      void invoke<Entry[]>("vault_list")
        .then((updated) => {
          if (!disposed) {
            setEntries(updated);
            setDeleted(null);
            setSecret("");
            setShown(false);
            secretRequest.current++;
          }
        })
        .catch(() => {
          if (!disposed) setToast("密码库已变化，请锁定后重新解锁刷新。");
        });
    })
      .then((unlisten) => {
        if (disposed) unlisten();
        else cleanup = unlisten;
      })
      .catch(() => {
        if (!disposed) setToast("数据更新通知连接失败。");
      });
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [persistent]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 2800);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k" && !locked) {
        e.preventDefault();
        setDialog({ kind: "search" });
      }
    };
    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, [locked]);
  const list = useMemo(() => {
    const items = entries.filter(
      (e) =>
        (filter === "all" ||
          (filter === "favorite" && e.favorite) ||
          (filter === "recent" && recent.includes(e.id)) ||
          e.category === filter) &&
        `${e.name} ${e.user} ${e.url}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    );
    if (sort === "name")
      items.sort((a, b) => a.name.localeCompare(b.name, "zh"));
    else if (filter === "recent")
      items.sort((a, b) => recent.indexOf(a.id) - recent.indexOf(b.id));
    return items;
  }, [entries, filter, query, sort, recent]);
  const current = list.find((e) => e.id === selected) ?? list[0];
  useEffect(() => {
    setShown(false);
    setSecret("");
    secretRequest.current++;
  }, [current?.id]);
  useEffect(() => {
    let cancelled = false;
    setStrengths([]);
    setStrengthError("");
    if (!persistent) {
      setStrengths(
        entries.map((entry) => ({
          id: entry.id,
          score: [8, 6, 4, 7, 3, 5][(entry.id - 1) % 6],
        })),
      );
      return;
    }
    if (locked) return;
    setStrengthPending(true);
    void invoke<Strength[]>("vault_strengths")
      .then((values) => {
        if (!cancelled) setStrengths(values ?? []);
      })
      .catch(() => {
        if (!cancelled)
          setStrengthError("暂时无法读取强度分布，请稍后重新打开。");
      })
      .finally(() => {
        if (!cancelled) setStrengthPending(false);
      });
    return () => {
      cancelled = true;
    };
  }, [entries, persistent, locked]);
  const title =
    page === "vault"
      ? navigation.find((n) => n.id === filter)!.label
      : (
          {
            browser: "浏览器插件",
            statistics: "密码统计",
            settings: "设置",
          } as const
        )[page];
  const select = (entry: Entry) => {
    setSelected(entry.id);
    setShown(false);
    setRecent((prev) =>
      [entry.id, ...prev.filter((id) => id !== entry.id)].slice(0, 6),
    );
  };
  const lock = useCallback(() => {
    if (persistent) {
      onVaultLock?.();
      return;
    }
    lockedRef.current = true;
    setShown(false);
    setDialog(null);
    setToast("");
    setDeleted(null);
    setLocked(true);
  }, [persistent, onVaultLock]);
  useIdleLock(minutes, locked, lock);
  useEffect(() => {
    if (!persistent || locked) return;
    let last = 0;
    const touch = () => {
      if (Date.now() - last < 1000) return;
      last = Date.now();
      void invoke("vault_touch", { minutes }).catch(() => onVaultLock?.());
    };
    touch();
    const events = ["pointerdown", "pointermove", "keydown", "wheel"];
    events.forEach((name) => window.addEventListener(name, touch));
    return () =>
      events.forEach((name) => window.removeEventListener(name, touch));
  }, [persistent, locked, minutes, onVaultLock]);
  const mutate = async (command: string, args: Record<string, unknown>) => {
    if (mutation.current) return false;
    mutation.current = true;
    setSaving(true);
    setOperationError("");
    try {
      const result = await invoke<Entry[]>(command, args);
      if (!alive.current) return false;
      setEntries(result);
      if (command === "vault_save" && (args.entry as Entry)?.id === 0)
        setSelected(result.at(-1)?.id ?? 0);
      return true;
    } catch (error) {
      if (alive.current)
        setOperationError(
          typeof error === "string" ? error : "保存失败，请重试。",
        );
      return false;
    } finally {
      mutation.current = false;
      if (alive.current) setSaving(false);
    }
  };
  const reveal = async () => {
    if (shown) {
      secretRequest.current++;
      setShown(false);
      setSecret("");
      return;
    }
    if (!persistent) {
      setShown(true);
      return;
    }
    if (!current) return;
    const request = ++secretRequest.current;
    try {
      const value = await invoke<string>("vault_reveal", { id: current.id });
      if (alive.current && request === secretRequest.current) {
        setSecret(value);
        setShown(true);
      }
    } catch (error) {
      if (alive.current) setToast(String(error));
    }
  };
  const copyField = async (field: "user" | "password") => {
    if (!persistent) {
      setToast("复制交互预览 · 未写入剪贴板");
      return;
    }
    try {
      await invoke("vault_copy", { id: current?.id, field });
      if (alive.current) setToast("已复制 · 30 秒后尝试清理");
    } catch (error) {
      if (alive.current) setToast(String(error));
    }
  };
  const favorite = async (entry: Entry) => {
    if (persistent) {
      await mutate("vault_save", {
        entry: { ...entry, favorite: !entry.favorite },
        password: null,
      });
      return;
    }
    setEntries((prev) =>
      prev.map((item) =>
        item.id === entry.id ? { ...item, favorite: !item.favorite } : item,
      ),
    );
  };
  const action = (a: WheelAction) => {
    if (a === "lock") lock();
    else if (a === "vault") {
      setPage("vault");
      setFilter("all");
      setQuery("");
      searchRef.current?.focus();
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else setDialog({ kind: a });
  };
  const save = async (entry: Entry, password?: string) => {
    secretRequest.current++;
    setSecret("");
    setShown(false);
    if (persistent) {
      if (
        await mutate("vault_save", {
          entry: {
            ...entry,
            id: dialog?.kind === "edit" && dialog.entry ? entry.id : 0,
          },
          password: password ?? null,
        })
      ) {
        setFilter("all");
        setQuery("");
        setDialog(null);
        setToast("已加密保存");
      }
      return;
    }
    nextId.current = Math.max(nextId.current, entry.id + 1);
    setEntries((prev) =>
      prev.some((e) => e.id === entry.id)
        ? prev.map((e) => (e.id === entry.id ? entry : e))
        : [...prev, entry],
    );
    setFilter("all");
    setQuery("");
    setSelected(entry.id);
    setDialog(null);
    setToast("演示记录已更新 · 本次会话有效");
  };
  const remove = async (entry: Entry) => {
    const index = entries.findIndex((item) => item.id === entry.id);
    if (index < 0) {
      setDialog(null);
      return;
    }
    const position = list.findIndex((item) => item.id === entry.id);
    if (persistent && !(await mutate("vault_delete", { id: entry.id }))) return;
    setDeleted({
      entry: entries[index],
      index,
      recentIndex: recent.indexOf(entry.id),
    });
    if (!persistent)
      setEntries((prev) => prev.filter((item) => item.id !== entry.id));
    setRecent((prev) => prev.filter((id) => id !== entry.id));
    setSelected(list[position + 1]?.id ?? list[position - 1]?.id ?? 0);
    setShown(false);
    setToast("");
    setDialog(null);
  };
  const undo = async () => {
    if (!deleted) return;
    if (persistent) {
      if (!(await mutate("vault_undo", {}))) return;
    } else setEntries((prev) => restoreEntry(prev, deleted));
    setRecent((prev) => restoreRecent(prev, deleted));
    setSelected(deleted.entry.id);
    setFilter("all");
    setQuery("");
    setShown(false);
    setDeleted(null);
    setToast("已恢复账号");
  };
  if (locked)
    return (
      <section className="lock-screen">
        <OrangeMark />
        <div className="eyebrow">A LITTLE SECRET, SAFELY KEPT.</div>
        <h2>秘密，暂时合上。</h2>
        <p>直到密码变成一颗酸橙</p>
        <button autoFocus className="primary" onClick={() => setLocked(false)}>
          回到收藏室 ↗
        </button>
        <small>演示锁定 · 尚未接入加密密码库</small>
      </section>
    );
  return (
    <>
      <div className="app workspace">
        <aside className="sidebar">
          <a
            className="brand"
            href="#"
            aria-label="返回密码库"
            onClick={(e) => {
              e.preventDefault();
              action("vault");
            }}
          >
            <OrangeMark />
            <span>
              直到密码
              <br />
              变成一颗酸橙<small>UNTIL / A LIME</small>
            </span>
          </a>
          <div className="edition">
            私人收藏室 <span>VOL. 01</span>
          </div>
          <nav aria-label="主要导航">
            {navigation
              .filter((n) => n.id === "all" || n.id === "favorite")
              .map((n) => (
                <div key={n.id} className="nav-item">
                  <button
                    className={`nav ${page === "vault" && filter === n.id ? "active" : ""}`}
                    aria-current={
                      page === "vault" && filter === n.id ? "page" : undefined
                    }
                    onClick={() => {
                      setPage("vault");
                      setFilter(n.id);
                    }}
                  >
                    <span>{n.icon}</span>
                    {n.label}
                    {n.id === "all" && <b>{entries.length}</b>}
                    {n.id === "favorite" && (
                      <b>{entries.filter((e) => e.favorite).length}</b>
                    )}
                  </button>
                </div>
              ))}
            <div className="nav-label">工具 / TOOLS</div>
            {(
              [
                ["browser", "◎", "浏览器插件"],
                ["statistics", "▥", "密码统计"],
                ["settings", "⚙", "设置"],
              ] as const
            ).map(([id, icon, label]) => (
              <button
                key={id}
                className={`nav ${page === id ? "active" : ""}`}
                aria-current={page === id ? "page" : undefined}
                onClick={() => setPage(id)}
              >
                <span aria-hidden="true">{icon}</span>
                {label}
              </button>
            ))}
            <button
              className="nav"
              onClick={() => setDialog({ kind: "generate" })}
            >
              <span aria-hidden="true">↻</span>密码生成器
            </button>
          </nav>
          <div className="sidebar-bottom">
            <button
              id="theme"
              onClick={() => changeTheme(dark ? "light" : "dark")}
            >
              ◐ <span>切换深浅色</span>
            </button>
            <button onClick={lock}>
              ⌑ <span>锁定收藏室</span>
            </button>
            <div className="profile">
              <span className="avatar">L</span>
              <div>
                一位酸橙收藏家
                <small>
                  {runtime} · {persistent ? "加密密码库" : "演示数据"}
                </small>
              </div>
              <span className="dot" />
            </div>
          </div>
        </aside>
        <main>
          <header className="topbar">
            <div>
              <span className="breadcrumb">收藏室</span>
              <span className="slash">/</span>
              {title}
            </div>
            <span className="demo-label">
              开发预览 · {persistent ? "本地加密" : "虚构数据"}
            </span>
            <button
              className="icon-button"
              aria-label="预览说明"
              onClick={() => setDialog({ kind: "help" })}
            >
              ?
            </button>
          </header>
          {page === "browser" && (
            <div className="workspace-page">
              <BrowserSetup />
            </div>
          )}
          {page === "statistics" && (
            <PasswordStatistics
              entries={entries}
              strengths={strengths}
              pending={strengthPending}
              error={strengthError}
              persistent={persistent}
            />
          )}
          {page === "settings" && (
            <div className="workspace-page">
              <SettingsPanel
                onImported={(updated) => {
                  setEntries(updated);
                  setDeleted(null);
                  setSecret("");
                  setShown(false);
                  secretRequest.current++;
                }}
                theme={theme}
                onTheme={changeTheme}
                minutes={minutes}
                onMinutes={changeMinutes}
                persistent={persistent}
              />
            </div>
          )}
          {page === "vault" && (
            <section className="vault">
              {operationError && !dialog && (
                <p role="alert" className="operation-error">
                  {operationError}
                </p>
              )}
              <div className="collection">
                <div className="list-column">
                  <div className="section-heading">
                    <div>
                      <span className="eyebrow">YOUR COLLECTION</span>
                      <h2>
                        {title}{" "}
                        <small>{String(list.length).padStart(2, "0")}</small>
                      </h2>
                    </div>
                    <button
                      className="primary"
                      onClick={() => setDialog({ kind: "edit" })}
                    >
                      ＋ 添加账号
                    </button>
                  </div>
                  <div className="toolbar">
                    <label className="search">
                      <span>⌕</span>
                      <input
                        ref={searchRef}
                        type="search"
                        aria-label="搜索账号"
                        placeholder="搜索网站或账号"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                      <kbd>Ctrl K</kbd>
                    </label>
                    <select
                      aria-label="账号排序"
                      value={sort}
                      onChange={(e) => setSort(e.target.value)}
                    >
                      <option value="default">默认排序</option>
                      <option value="name">名称排序</option>
                    </select>
                  </div>
                  <div className="category-tabs" aria-label="账号分类">
                    {["all", "工作", "生活", "娱乐", "recent"].map((id) => (
                      <button
                        key={id}
                        aria-pressed={filter === id}
                        className={filter === id ? "selected" : ""}
                        onClick={() => setFilter(id as Filter)}
                      >
                        {id === "all" ? "全部" : id === "recent" ? "最近" : id}
                      </button>
                    ))}
                  </div>
                  <div className="list-header">
                    <span>账号 / ACCOUNT</span>
                    <span>分类</span>
                  </div>
                  <div>
                    {list.map((entry) => (
                      <AccountRow
                        key={entry.id}
                        entry={entry}
                        selected={current?.id === entry.id}
                        onSelect={() => select(entry)}
                      />
                    ))}
                    {list.length === 0 && (
                      <div className="empty">
                        这里还没有账号。<p>试试其他关键词，或添加一个账号。</p>
                        <button
                          className="empty-add"
                          onClick={() => setDialog({ kind: "edit" })}
                        >
                          ＋ 添加账号
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="list-footer">
                    {persistent
                      ? "账号更改自动加密保存"
                      : "账号改动仅在本次会话中生效"}{" "}
                    <span>＋</span>
                  </div>
                </div>
                <article className="detail">
                  {current ? (
                    <>
                      <div className="detail-heading">
                        <span className="account-icon">{current.icon}</span>
                        <div>
                          <h3>{current.name}</h3>
                          <small>
                            COLLECTION / {String(current.id).padStart(3, "0")}
                          </small>
                        </div>
                        <button
                          className="star"
                          aria-label={
                            current.favorite ? "取消收藏" : "收藏账号"
                          }
                          disabled={saving}
                          onClick={() => void favorite(current)}
                        >
                          {current.favorite ? "★" : "☆"}
                        </button>
                      </div>
                      <div className="credential-overview">
                        <div className="credential-fields">
                          <div className="field-label">用户名</div>
                          <div className="field">
                            <span className="field-value">{current.user}</span>
                            <button onClick={() => void copyField("user")}>
                              复制
                            </button>
                          </div>
                          <div className="field-label">
                            密码{!persistent && " · 演示值"}
                          </div>
                          <div className="field">
                            <span className="field-value">
                              {shown
                                ? persistent
                                  ? secret
                                  : "Lime-demo-only-2026!"
                                : "•••• •••• •••• ••••"}
                            </span>
                            <button onClick={() => void reveal()}>
                              {shown ? "隐藏" : "显示"}
                            </button>
                            <button onClick={() => void copyField("password")}>
                              复制
                            </button>
                          </div>
                        </div>
                        <div className="strength-card">
                          <OrangeStrength
                            score={
                              strengths.find((s) => s.id === current.id)?.score
                            }
                          />
                        </div>
                      </div>
                      <div className="detail-metadata">
                        <div className="field-label">网站</div>
                        <div className="field">
                          <span className="field-value">{current.url}</span>
                          <span>↗</span>
                        </div>
                        <div className="field-label">便笺</div>
                        <p className="note">{current.note}</p>
                      </div>
                      {persistent && <SteamFillPanel id={current.id} />}
                      <div className="detail-bottom">
                        <button onClick={() => setDialog({ kind: "search" })}>
                          快捷搜索 ↗
                        </button>
                        <button
                          onClick={() =>
                            setDialog({ kind: "edit", entry: current })
                          }
                        >
                          编辑记录
                        </button>
                      </div>
                      <button
                        className="delete-entry"
                        onClick={() =>
                          setDialog({ kind: "delete", entry: current })
                        }
                      >
                        删除账号
                      </button>
                    </>
                  ) : (
                    <div className="empty">选一个账号，看看它的故事。</div>
                  )}
                </article>
              </div>
            </section>
          )}
          <footer className="page-footer">
            <span>把复杂留给世界，把简单留给自己。</span>
            <span>LIME / DESIGN STUDY — 2026</span>
          </footer>
        </main>
      </div>
      {!isTauri() && <Wheel onAction={action} />}
      {!deleted && toast && (
        <div id="toast" role="status" className="visible">
          {toast}
        </div>
      )}
      {deleted && (
        <div className="undo-notice" role="status">
          <span>
            已删除「{deleted.entry.name}」
            <small>10 秒内可撤销最近一次删除</small>
          </span>
          <button disabled={saving} onClick={() => void undo()}>
            撤销
          </button>
          <button aria-label="关闭撤销提示" onClick={() => setDeleted(null)}>
            ×
          </button>
        </div>
      )}
      {dialog && (
        <Modal
          title={
            dialog.kind === "search"
              ? "寻找一颗酸橙"
              : dialog.kind === "edit"
                ? persistent
                  ? "编辑账号"
                  : "编辑演示账号"
                : dialog.kind === "generate"
                  ? "密码生成器"
                  : dialog.kind === "delete"
                    ? "删除账号"
                    : dialog.kind === "settings"
                      ? "收藏室设置"
                      : "应用说明"
          }
          onClose={() => {
            if (!saving) {
              setDialog(null);
              setOperationError("");
            }
          }}
        >
          {operationError && (
            <p role="alert" className="operation-error">
              {operationError}
            </p>
          )}
          {dialog.kind === "search" && (
            <QuickSearch
              entries={entries}
              onSelect={(entry) => {
                setPage("vault");
                setFilter("all");
                setQuery("");
                select(entry);
                setDialog(null);
              }}
            />
          )}
          {dialog.kind === "edit" && (
            <EntryForm
              entry={dialog.entry}
              nextId={nextId.current}
              onSave={save}
              persistent={persistent}
              saving={saving}
            />
          )}
          {dialog.kind === "settings" && (
            <SettingsPanel
              onImported={(updated) => {
                setEntries(updated);
                setDeleted(null);
                setSecret("");
                setShown(false);
                secretRequest.current++;
                setFilter("all");
                setQuery("");
              }}
              theme={theme}
              onTheme={changeTheme}
              minutes={minutes}
              onMinutes={changeMinutes}
              persistent={persistent}
            />
          )}
          {dialog.kind === "generate" && <Generator />}
          {dialog.kind === "delete" && (
            <>
              <div className="eyebrow">REMOVE / 移出收藏室</div>
              <h2>删除这颗酸橙？</h2>
              <div className="delete-summary">
                <strong>{dialog.entry.name}</strong>
                <span>{dialog.entry.user}</span>
              </div>
              <p>
                将移除这个账号及其收藏、最近使用记录。删除后有 10
                秒可以撤销最近一次操作。
              </p>
              <div className="delete-actions">
                <button autoFocus onClick={() => setDialog(null)}>
                  保留账号
                </button>
                <button
                  className="confirm-delete"
                  disabled={saving}
                  onClick={() => void remove(dialog.entry)}
                >
                  确认删除
                </button>
              </div>
            </>
          )}
          {dialog.kind === "help" && (
            <>
              <div className="eyebrow">UNTIL / A LIME — 0.1</div>
              <h2>直到密码变成一颗酸橙</h2>
              <p>
                React + TypeScript 界面，Tauri 2 桌面容器。当前运行环境：
                {runtime}。
              </p>
              <p>
                桌面账号加密保存到本机，浏览器预览只保留演示数据。主题偏好和桌面轮盘位置会保存在本机。桌面版支持独立悬浮轮盘和托盘。关闭主窗口只隐藏到托盘并保持解锁；退出请使用托盘菜单；托盘也可重置轮盘位置。生成器支持复制及定时清理；账号密码按需显示和复制。尚未接入跨应用填写。
              </p>
            </>
          )}
        </Modal>
      )}
    </>
  );
}
function QuickSearch({
  entries,
  onSelect,
}: {
  entries: Entry[];
  onSelect: (e: Entry) => void;
}) {
  const [query, setQuery] = useState("");
  const matches = entries.filter((e) =>
    (e.name + e.user).toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      <div className="eyebrow">QUICK ACCESS / 随手可及</div>
      <h2>寻找一颗酸橙</h2>
      <input
        autoFocus
        aria-label="快捷搜索账号"
        placeholder="搜索账号…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="quick-results">
        {matches.map((e) => (
          <AccountRow key={e.id} entry={e} onSelect={() => onSelect(e)} />
        ))}
        {!matches.length && <p>没有匹配账号</p>}
      </div>
      <p>选择账号查看详情。此版本不向其他应用输入。</p>
    </>
  );
}
function EntryForm({
  entry,
  nextId,
  onSave,
  persistent = false,
  saving = false,
}: {
  entry?: Entry;
  nextId: number;
  onSave: (e: Entry, password?: string) => void;
  persistent?: boolean;
  saving?: boolean;
}) {
  const [error, setError] = useState("");
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const name = String(data.get("name")).trim(),
      user = String(data.get("user")).trim();
    if (!name || !user) {
      setError("名称和用户名不能只包含空格。");
      return;
    }
    onSave(
      {
        id: entry?.id ?? nextId,
        name,
        user,
        category: data.get("category") as Category,
        icon: entry?.icon ?? "L",
        favorite: entry?.favorite ?? false,
        url: String(data.get("url")).trim() || "example.invalid",
        note: String(data.get("note")).trim(),
      },
      persistent ? String(data.get("password")) || undefined : undefined,
    );
  };
  return (
    <>
      <div className="eyebrow">A NEW LITTLE SECRET</div>
      <h2>{entry ? "编辑这颗酸橙" : "收藏一颗新酸橙"}</h2>
      <p>
        {persistent
          ? "账号将加密保存到本机。编辑时密码留空表示保持原密码。"
          : "仅填写虚构资料；浏览器预览不保存密码。"}
      </p>
      <form onSubmit={submit}>
        <fieldset className="entry-fields" disabled={saving}>
          <label>
            名称
            <input
              name="name"
              autoFocus
              maxLength={40}
              required
              defaultValue={entry?.name}
            />
          </label>
          <label>
            用户名
            <input
              name="user"
              maxLength={80}
              required
              defaultValue={entry?.user}
            />
          </label>
          <label>
            分类
            <select name="category" defaultValue={entry?.category ?? "工作"}>
              {(["工作", "生活", "娱乐"] as Category[]).map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          {persistent && (
            <label>
              密码
              <input
                type="password"
                name="password"
                required={!entry}
                maxLength={1024}
                autoComplete="new-password"
                placeholder={entry ? "留空保持原密码" : "输入账号密码"}
              />
            </label>
          )}
          <label>
            网站
            <input
              name="url"
              maxLength={160}
              defaultValue={entry?.url}
              placeholder="example.invalid"
            />
          </label>
          <label>
            便笺
            <textarea name="note" maxLength={240} defaultValue={entry?.note} />
          </label>
          {error && <p role="alert">{error}</p>}
          <button className="primary">
            {saving
              ? "正在保存…"
              : persistent
                ? "加密保存 ↗"
                : "保存演示记录 ↗"}
          </button>
        </fieldset>
      </form>
    </>
  );
}
