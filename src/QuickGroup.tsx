import { useState } from "react";
import type { Entry } from "./model";

export default function QuickGroup({
  entry,
  options,
  busy,
  onApply,
}: {
  entry: Entry;
  options: string[];
  busy: boolean;
  onApply: (category: string, remember: boolean) => Promise<boolean>;
}) {
  const [category, setCategory] = useState(entry.category);
  const [custom, setCustom] = useState(false);
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState("");
  return (
    <details className="quick-group">
      <summary>
        分组 · {entry.category} <span>更换 ↗</span>
      </summary>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          const clean = category.trim();
          if (!clean || [...clean].length > 24) {
            setError("请填写 1–24 字的分组名称。");
            return;
          }
          setError("");
          await onApply(clean, remember);
        }}
      >
        <fieldset disabled={busy}>
          <label>
            更换分组
            <select
              value={custom ? "" : category}
              onChange={(e) => {
                setCustom(e.target.value === "");
                setCategory(e.target.value);
              }}
            >
              {options.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
              <option value="">自定义分组…</option>
            </select>
          </label>
          {custom && (
            <label>
              自定义分组
              <input
                autoFocus
                maxLength={24}
                required
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              />
            </label>
          )}
          <label className="group-remember">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
            以后此网站使用这个分组
          </label>
          <button
            className="primary"
            disabled={
              !category.trim() ||
              (category.trim() === entry.category && !remember)
            }
          >
            {busy ? "正在保存…" : "应用分组"}
          </button>
        </fieldset>
        {error && <p role="alert">{error}</p>}
      </form>
    </details>
  );
}
