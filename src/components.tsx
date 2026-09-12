import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { Entry } from "./model";
import mark from "./orange-mark.svg";

export function OrangeMark() {
  return <img className="orange-mark" src={mark} alt="" draggable={false} />;
}
export function AccountRow({
  entry,
  selected,
  onSelect,
}: {
  entry: Entry;
  selected?: boolean;
  onSelect: () => void;
}) {
  const descriptionId = useId();
  return (
    <button
      className={`account ${selected ? "selected" : ""}`}
      aria-label={`查看 ${entry.name}`}
      aria-describedby={descriptionId}
      aria-current={selected || undefined}
      onClick={onSelect}
    >
      <span className="account-icon" aria-hidden="true">
        {entry.icon}
      </span>
      <span className="account-copy">
        <strong>{entry.name}</strong>
        <small id={descriptionId}>
          {entry.user} · {entry.category}
        </small>
      </span>
      <span className="tag">{entry.category}</span>
    </button>
  );
}
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    const trigger =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    dialog.showModal();
    return () => {
      dialog.close();
      if (trigger?.isConnected) trigger.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) {
          const r = ref.current.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            onClose();
        }
      }}
    >
      <button className="modal-close" aria-label="关闭" onClick={onClose}>
        ×
      </button>
      {children}
    </dialog>
  );
}
export type WheelAction = "search" | "generate" | "lock" | "vault";
export function Wheel({
  onAction,
  onOpenChange,
  dismissOnWindowBlur = false,
  onDrag,
}: {
  onAction: (action: WheelAction) => void;
  onOpenChange?: (open: boolean) => void;
  dismissOnWindowBlur?: boolean;
  onDrag?: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false),
    [pinned, setPinned] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const center = useRef<HTMLButtonElement>(null);
  const petals = useRef<(HTMLButtonElement | null)[]>([]);
  const ringId = useId(),
    hintId = useId();
  const gesture = useRef<{ x: number; y: number; dragged: boolean } | null>(
    null,
  );
  const dragging = useRef(false);
  const suppressClick = useRef(false);
  const clear = () => clearTimeout(timer.current);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    onOpenChange?.(open);
  }, [open, onOpenChange]);
  useEffect(() => {
    if (!dismissOnWindowBlur) return;
    const close = () => {
      if (dragging.current) return;
      gesture.current = null;
      clearTimeout(timer.current);
      setPinned(false);
      setOpen(false);
    };
    window.addEventListener("blur", close);
    return () => window.removeEventListener("blur", close);
  }, [dismissOnWindowBlur]);
  const actions: {
    id: WheelAction;
    position: string;
    icon: string;
    label: string;
  }[] = [
    { id: "search", position: "top", icon: "⌕", label: "寻找账号" },
    { id: "generate", position: "right", icon: "✳", label: "生成密码" },
    { id: "lock", position: "bottom", icon: "⌑", label: "锁定" },
    { id: "vault", position: "left", icon: "▦", label: "收藏室" },
  ];
  return (
    <section
      className={`wheel ${open ? "open" : ""}`}
      aria-label="悬浮轮盘"
      onPointerEnter={clear}
      onPointerLeave={() => {
        if (!pinned && !dragging.current)
          timer.current = setTimeout(() => setOpen(false), 350);
      }}
      onBlur={(e) => {
        if (
          !e.currentTarget.contains(e.relatedTarget) &&
          !pinned &&
          !dragging.current
        )
          setOpen(false);
      }}
      onKeyDown={(e) => {
        const direction = {
          ArrowUp: 0,
          ArrowRight: 1,
          ArrowDown: 2,
          ArrowLeft: 3,
        }[e.key as "ArrowUp" | "ArrowRight" | "ArrowDown" | "ArrowLeft"];
        if (direction !== undefined) {
          e.preventDefault();
          clear();
          setOpen(true);
          requestAnimationFrame(() => petals.current[direction]?.focus());
        }
        if (e.key === "Escape") {
          e.preventDefault();
          clear();
          e.stopPropagation();
          center.current?.focus();
          setPinned(false);
          setOpen(false);
        }
      }}
    >
      <div className="wheel-ring" id={ringId} aria-hidden={!open}>
        <span className="wheel-orbit" />
        {actions.map((a, index) => (
          <button
            ref={(element) => {
              petals.current[index] = element;
            }}
            key={a.id}
            className={`petal p-${a.position}`}
            tabIndex={open ? 0 : -1}
            onClick={() => {
              clear();
              setOpen(false);
              setPinned(false);
              onAction(a.id);
            }}
          >
            <span aria-hidden="true">{a.icon}</span>
            {a.label}
          </button>
        ))}
      </div>
      <button
        ref={center}
        className="wheel-center"
        title={onDrag ? "悬停展开 · 单击固定 · 按住橙子拖动" : undefined}
        aria-label="展开快捷轮盘"
        aria-expanded={open}
        aria-controls={ringId}
        aria-describedby={hintId}
        onFocus={() => {
          if (!dragging.current) setOpen(true);
        }}
        onPointerEnter={(e) => {
          if (e.pointerType !== "touch" && !dragging.current) {
            clear();
            setOpen(true);
          }
        }}
        onPointerDown={(e) => {
          if (!onDrag || e.button !== 0) return;
          clear();
          suppressClick.current = false;
          gesture.current = { x: e.screenX, y: e.screenY, dragged: false };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const start = gesture.current;
          if (!onDrag || !start || start.dragged || !(e.buttons & 1)) return;
          if (Math.hypot(e.screenX - start.x, e.screenY - start.y) < 6) return;
          start.dragged = true;
          dragging.current = true;
          suppressClick.current = true;
          clear();
          if (e.currentTarget.hasPointerCapture(e.pointerId))
            e.currentTarget.releasePointerCapture(e.pointerId);
          void onDrag().finally(() => {
            dragging.current = false;
            gesture.current = null;
            setPinned(false);
            setOpen(false);
          });
        }}
        onPointerUp={() => {
          gesture.current = null;
        }}
        onPointerCancel={() => {
          gesture.current = null;
        }}
        onClick={(e) => {
          if (suppressClick.current && e.detail !== 0) {
            suppressClick.current = false;
            return;
          }
          setPinned(!pinned);
          setOpen(!pinned);
        }}
      >
        <OrangeMark />
      </button>
      <span className="wheel-hint" id={hintId}>
        悬停展开 · 方向键选择 · Esc 收起
      </span>
    </section>
  );
}
