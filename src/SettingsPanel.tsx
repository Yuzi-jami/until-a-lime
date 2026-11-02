import type {
  AutoLockMinutes,
  FontScale,
  ThemePreference,
} from "./preferences";
import AccessSettings from "./AccessSettings";
import BrowserSetup from "./BrowserSetup";
import DataSettings from "./DataSettings";
import type { Entry } from "./model";
import { useState } from "react";
import { MAX_AUTO_LOCK_MINUTES } from "./preferences";

const lockOptions = [1, 5, 15, 30, 60, 120, 240, 480, 0];

export default function SettingsPanel({
  theme,
  onTheme,
  fontScale,
  onFontScale,
  minutes,
  onMinutes,
  persistent = false,
  onImported,
}: {
  theme: ThemePreference;
  onTheme: (theme: ThemePreference) => void;
  fontScale: FontScale;
  onFontScale: (scale: FontScale) => void;
  minutes: AutoLockMinutes;
  onMinutes: (minutes: AutoLockMinutes) => void;
  persistent?: boolean;
  onImported?: (entries: Entry[]) => void;
}) {
  const [custom, setCustom] = useState(!lockOptions.includes(minutes));
  const [draft, setDraft] = useState(String(minutes || 60));
  const [lockError, setLockError] = useState("");
  return (
    <section className="settings-panel">
      <div className="eyebrow">MAKE IT YOURS / 一点偏爱</div>
      <h2>收藏室设置</h2>
      <p>按你的习惯，调整这一小块空间。</p>
      <AccessSettings />
      <fieldset>
        <legend>外观</legend>
        <div className="theme-choices">
          {(
            [
              { id: "light", label: "暖纸浅色", icon: "☀" },
              { id: "dark", label: "夜色深棕", icon: "◐" },
              { id: "system", label: "跟随系统", icon: "◈" },
            ] as const
          ).map((item) => (
            <label
              className={theme === item.id ? "selected" : ""}
              key={item.id}
            >
              <input
                type="radio"
                name="theme-preference"
                value={item.id}
                checked={theme === item.id}
                onChange={() => onTheme(item.id)}
              />
              <span aria-hidden="true">{item.icon}</span>
              {item.label}
            </label>
          ))}
        </div>
        <label className="settings-font-scale" htmlFor="font-scale">
          <span>界面字号</span>
          <output>{Math.round(fontScale * 100)}%</output>
          <input
            id="font-scale"
            type="range"
            min={0.9}
            max={1.3}
            step={0.05}
            value={fontScale}
            onChange={(event) => onFontScale(Number(event.target.value))}
            aria-label="界面字号"
          />
          <small>调整文字大小，不改变页面布局。</small>
        </label>
      </fieldset>
      <label className="settings-lock" htmlFor="auto-lock">
        闲置后锁定
        <select
          id="auto-lock"
          value={custom ? "custom" : minutes}
          onChange={(event) => {
            setLockError("");
            setCustom(event.target.value === "custom");
            if (event.target.value !== "custom")
              onMinutes(Number(event.target.value));
            else setDraft(String(minutes || 60));
          }}
        >
          <option value={1}>1 分钟</option>
          <option value={5}>5 分钟</option>
          <option value={15}>15 分钟</option>
          <option value={30}>30 分钟</option>
          <option value={60}>1 小时</option>
          <option value={120}>2 小时</option>
          <option value={240}>4 小时</option>
          <option value={480}>8 小时</option>
          <option value="custom">自定义…</option>
          <option value={0}>不自动锁定</option>
        </select>
      </label>
      {custom && (
        <form
          className="settings-custom-lock"
          onSubmit={(event) => {
            event.preventDefault();
            const value = Number(draft);
            if (
              !/^\d+$/.test(draft) ||
              !Number.isInteger(value) ||
              value < 1 ||
              value > MAX_AUTO_LOCK_MINUTES
            ) {
              setLockError("请输入 1–1440 的整数分钟数。");
              return;
            }
            onMinutes(value);
            setLockError("");
          }}
        >
          <label>
            自定义分钟数
            <input
              type="number"
              min={1}
              max={MAX_AUTO_LOCK_MINUTES}
              step={1}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
          </label>
          <button className="secondary" type="submit">
            应用时长
          </button>
          <small>
            当前：{minutes ? `${minutes} 分钟` : "不自动锁定"}；最多 24 小时。
          </small>
          {lockError && <p role="alert">{lockError}</p>}
        </form>
      )}
      <p>
        以主窗口内的鼠标和键盘操作计算闲置时间。锁定会收起密码与面板；
        {persistent
          ? "解锁需要主密码，后台会检查闲置时间。"
          : "当前为演示锁定，尚未接入主密码验证。"}
      </p>
      {persistent && onImported && <DataSettings onImported={onImported} />}
      <BrowserSetup />
      <div className="settings-note">
        偏好立即生效并保存在本机。
        {persistent
          ? "账号内容加密保存到本机。"
          : "账号内容仍只在本次会话中保留。"}
      </div>
    </section>
  );
}
