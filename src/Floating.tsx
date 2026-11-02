import { useTheme } from "./usePreferences";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { flushSync } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { OrangeMark, Wheel, type WheelAction } from "./components";
import type { Entry } from "./model";
import QuickSave from "./QuickSave";
import type { SaveContext } from "./categories";
import "./floating.css";

type FloatingLayout = "panel" | "editor" | "notice" | "wheel" | "compact";
type MotionFrame = {
  id: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
};

export default function Floating() {
  useTheme();
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"wheel" | "search" | "save" | "armed">(
    "wheel",
  );
  const [saveContext, setSaveContext] = useState<SaveContext | null>(null);
  const [query, setQuery] = useState("");
  const [accounts, setAccounts] = useState<Entry[]>([]);
  const [status, setStatus] = useState("");
  const [wheelOpen, setWheelOpen] = useState(false);
  const [edge, setEdge] = useState<string | null>(null);
  const [appliedLayout, setAppliedLayout] = useState<FloatingLayout>("compact");
  const [dragRevision, setDragRevision] = useState(0);
  const [moving, setMoving] = useState(false);
  const [motion, setMotion] = useState<MotionFrame | null>(null);
  const surface = useRef<HTMLDivElement>(null);
  const motionEpoch = useRef(0);
  const activeAnimation = useRef<Animation | null>(null);
  const lastApplied = useRef<FloatingLayout>("compact");
  const dragging = useRef(false);
  const settleAfterDrag = useRef(false);
  const [busy, setBusy] = useState(false);
  const request = useRef(0);
  const resizeQueue = useRef<Promise<unknown>>(Promise.resolve());
  const layout =
    mode === "save"
      ? "editor"
      : mode === "search"
        ? "panel"
        : mode === "armed"
          ? "notice"
          : wheelOpen
            ? "wheel"
            : status || error
              ? "notice"
              : "compact";
  const openChanged = useCallback((open: boolean) => {
    setWheelOpen(open);
    if (open) {
      setStatus("");
      setError("");
    }
  }, []);
  useEffect(() => {
    if (mode !== "save") return;
    let last = 0;
    const touch = () => {
      if (Date.now() - last < 1000) return;
      last = Date.now();
      void invoke("floating_touch").catch(() => {
        request.current++;
        setSaveContext(null);
        setMode("wheel");
        setError("密码库已锁定，请先解锁收藏室。");
      });
    };
    window.addEventListener("pointerdown", touch);
    window.addEventListener("keydown", touch);
    return () => {
      window.removeEventListener("pointerdown", touch);
      window.removeEventListener("keydown", touch);
    };
  }, [mode]);
  useEffect(() => {
    if (dragging.current) return;
    let disposed = false;
    resizeQueue.current = resizeQueue.current
      .catch(() => {})
      .then(async () => {
        if (disposed || dragging.current) return;
        const epoch = motionEpoch.current;
        const settle = settleAfterDrag.current;
        const args = { layout, ...(settle ? { settle: true } : {}) };
        const wheel = surface.current?.querySelector<HTMLElement>(".wheel");
        const animate =
          wheel?.animate &&
          !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        let animation: Animation | undefined;
        const apply = (dock: string | null) => {
          lastApplied.current = layout;
          flushSync(() => {
            setEdge(dock);
            setAppliedLayout(layout);
            setMotion(null);
          });
        };
        try {
          if (
            animate &&
            !settle &&
            layout === "compact" &&
            lastApplied.current === "wheel"
          ) {
            // Let the menu fade out before the fruit starts sliding inward.
            await new Promise((resolve) => setTimeout(resolve, 90));
            if (disposed || dragging.current || epoch !== motionEpoch.current)
              return;
          }
          // Keep hover/focus restoration from reopening the menu mid-settlement.
          flushSync(() => setMoving(true));
          const frame = animate
            ? await invoke<MotionFrame | null>("prepare_floating_motion", args)
            : null;
          if (epoch !== motionEpoch.current) return;
          let dock: string | null;
          if (frame && wheel) {
            flushSync(() => setMotion(frame));
            animation = wheel.animate(
              [
                { translate: "0px 0px" },
                {
                  translate: `${frame.toX - frame.fromX}px ${frame.toY - frame.fromY}px`,
                },
              ],
              {
                duration: 230,
                easing: "cubic-bezier(0.22, 1, 0.36, 1)",
                fill: "forwards",
              },
            );
            activeAnimation.current = animation;
            await animation.finished;
            if (epoch !== motionEpoch.current) return;
            dock = await invoke<string | null>("finish_floating_motion", {
              id: frame.id,
            });
          } else {
            dock = await invoke<string | null>("floating_layout", args);
          }
          if (epoch !== motionEpoch.current) return;
          settleAfterDrag.current = false;
          // Match the geometry actually applied, even if a newer resize is queued.
          apply(dock);
        } catch {
          if (epoch === motionEpoch.current) {
            // Recover a staged surface if the compositor animation was cancelled.
            try {
              const dock = await invoke<string | null>("floating_layout", args);
              if (epoch === motionEpoch.current) {
                apply(dock);
                settleAfterDrag.current = false;
              }
            } catch {
              if (!disposed) setError("窗口调整失败，请从托盘重置轮盘位置。");
            }
          }
        } finally {
          animation?.cancel();
          activeAnimation.current = null;
          if (epoch === motionEpoch.current) {
            setMotion(null);
            setMoving(false);
          }
        }
      });
    return () => {
      disposed = true;
    };
  }, [layout, dragRevision]);
  useEffect(() => {
    if (mode !== "wheel" || (!status && !error)) return;
    const timer = setTimeout(
      () => {
        setStatus("");
        setError("");
      },
      error ? 6000 : 4500,
    );
    return () => clearTimeout(timer);
  }, [status, error, mode]);
  useEffect(() => {
    document.documentElement.classList.add("floating-document");

    return () => {
      document.documentElement.classList.remove("floating-document");
      motionEpoch.current++;
      activeAnimation.current?.cancel();
    };
  }, []);
  useEffect(() => {
    let disposed = false;
    const stops: (() => void)[] = [];
    const track = (pending: Promise<() => void>) => {
      void pending
        .then((stop) => {
          if (disposed) stop();
          else stops.push(stop);
        })
        .catch(() => {
          if (!disposed) setError("状态通知不可用，请重新打开应用。");
        });
    };
    track(
      listen("lime-floating-reset", () => {
        if (!disposed) {
          motionEpoch.current++;
          activeAnimation.current?.cancel();
          setMotion(null);
          setMoving(false);
          setEdge(null);
          setDragRevision((value) => value + 1);
        }
      }),
    );
    track(
      listen<string>("lime-quick-paste", ({ payload }) => {
        if (disposed) return;
        request.current++;
        setBusy(false);
        setMode("wheel");
        setWheelOpen(false);
        setError("");
        setStatus(
          payload === "password-ready"
            ? "密码已复制 · 请按 Ctrl + V"
            : payload === "expired"
              ? "等待已结束，请重新选择账号。"
              : payload === "unavailable"
                ? "快捷键监听启动失败，请重新选择账号。"
                : "连续填写已取消。",
        );
      }),
    );
    track(
      listen<string>("lime-action", ({ payload }) => {
        if (disposed || payload !== "lock") return;
        request.current++;
        setAccounts([]);
        setSaveContext(null);
        setQuery("");
        setBusy(false);
        setMode("wheel");
        setWheelOpen(false);
        setStatus("");
        setError("");
      }),
    );
    return () => {
      disposed = true;
      request.current++;
      stops.forEach((stop) => stop());
    };
  }, []);
  async function openSearch() {
    setError("");
    setStatus("");
    const token = ++request.current;
    try {
      const list = await invoke<Entry[]>("quick_paste_accounts");
      if (token !== request.current) return;
      setAccounts(list);
      setQuery("");
      setWheelOpen(false);
      setMode("search");
    } catch (e) {
      if (token !== request.current) return;
      setError(typeof e === "string" ? e : "密码库已锁定，请先打开收藏室。 ");
    }
  }
  async function openSave() {
    setError("");
    setStatus("");
    const token = ++request.current;
    try {
      const context = await invoke<SaveContext>("quick_save_context");
      if (token !== request.current) return;
      setSaveContext(context);
      setWheelOpen(false);
      setMode("save");
    } catch (e) {
      if (token === request.current)
        setError(typeof e === "string" ? e : "请先解锁收藏室。");
    }
  }
  async function arm(entry: Entry) {
    if (busy) return;
    const token = ++request.current;
    setBusy(true);
    try {
      const field = await invoke<string>("quick_paste_arm", { id: entry.id });
      if (token !== request.current) return;
      setError("");
      if (field === "password") {
        setMode("wheel");
        setWheelOpen(false);
        setStatus("密码已复制 · 请按 Ctrl + V");
      } else {
        setMode("armed");
        setStatus("用户名已复制 · 点击输入框后粘贴，再按 Tab");
      }
    } catch (e) {
      if (token === request.current)
        setError(typeof e === "string" ? e : "无法准备连续填写。 ");
    } finally {
      if (token === request.current) setBusy(false);
    }
  }
  const visibleAccounts = accounts.filter((entry) =>
    `${entry.name} ${entry.user} ${entry.url}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const action = (value: WheelAction) => {
    setError("");
    if (value === "save") {
      void openSave();
      return;
    }
    if (value === "search") {
      void openSearch();
      return;
    }
    invoke("desktop_action", { action: value }).catch(() =>
      setError("未能打开收藏室，请使用托盘重试。"),
    );
  };
  const drag = async () => {
    if (dragging.current) return;
    dragging.current = true;
    activeAnimation.current?.finish();
    try {
      await resizeQueue.current;
      // This command resolves on native mouse release/cancellation, not start.
      await invoke("drag_floating");
      settleAfterDrag.current = true;
      setError("");
      setStatus("");
      setWheelOpen(false);
    } catch {
      setError("拖动失败，请重试。");
    } finally {
      dragging.current = false;
      // One serialized resize also settles a fruit that was already compact.
      setDragRevision((value) => value + 1);
    }
  };
  return (
    <div
      ref={surface}
      className="floating-surface"
      data-layout={appliedLayout}
      data-edge={edge ?? "none"}
      data-moving={moving || undefined}
      data-motion={motion ? "sliding" : undefined}
      style={
        motion
          ? ({
              "--motion-x": `${motion.fromX - 130}px`,
              "--motion-y": `${motion.fromY - 130}px`,
            } as CSSProperties)
          : undefined
      }
    >
      {mode === "save" && saveContext && (
        <QuickSave
          context={saveContext}
          onClose={() => {
            request.current++;
            setSaveContext(null);
            setMode("wheel");
            setWheelOpen(false);
          }}
          onSaved={() => {
            setSaveContext(null);
            setMode("wheel");
            setWheelOpen(false);
            setStatus("账号已加密保存");
          }}
        />
      )}
      {mode === "wheel" && (
        <Wheel
          onAction={action}
          onOpenChange={openChanged}
          onDrag={drag}
          menuSuppressed={moving}
          dismissOnWindowBlur
        />
      )}
      {mode === "search" && (
        <section className="floating-search" aria-label="寻找账号">
          <button
            className="floating-back"
            onClick={() => {
              request.current++;
              setMode("wheel");
              setWheelOpen(false);
              setError("");
            }}
          >
            ‹
          </button>
          <strong>寻找账号</strong>
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索账号"
          />
          <div className="floating-results">
            {visibleAccounts.map((entry) => (
              <button
                key={entry.id}
                disabled={busy}
                onClick={() => void arm(entry)}
              >
                <span className="floating-account-icon">{entry.icon}</span>
                <span>
                  <b>{entry.name}</b>
                  <small>{entry.user || "未填写用户名"}</small>
                </span>
                <i>{entry.user ? "复制" : "复制密码"}</i>
              </button>
            ))}
            {!visibleAccounts.length && <p>没有找到账号</p>}
          </div>
        </section>
      )}
      {mode === "armed" && (
        <>
          <div className="armed-fruit">
            <OrangeMark />
          </div>
          <div className="floating-armed" role="status">
            <strong>连续填写已准备 · 最长 20 秒</strong>
            <span>{status}</span>
            <button
              onClick={() => {
                void invoke("quick_paste_cancel").then(
                  () => {
                    setMode("wheel");
                    setWheelOpen(false);
                    setStatus("连续填写已取消。");
                  },
                  () => setError("取消失败，请按 Esc 重试。"),
                );
              }}
            >
              取消
            </button>
          </div>
        </>
      )}
      {status && !error && mode === "wheel" && (
        <p className="float-status" role="status">
          {status}
        </p>
      )}
      {error && (
        <p className="float-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
