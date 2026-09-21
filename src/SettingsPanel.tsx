import type { AutoLockMinutes, ThemePreference } from "./preferences";
import AccessSettings from "./AccessSettings";
import BrowserSetup from "./BrowserSetup";
import DataSettings from "./DataSettings";
import type { Entry } from "./model";

export default function SettingsPanel({
  theme,
  onTheme,
  minutes,
  onMinutes,
  persistent = false,
  onImported,
}: {
  theme: ThemePreference;
  onTheme: (theme: ThemePreference) => void;
  minutes: AutoLockMinutes;
  onMinutes: (minutes: AutoLockMinutes) => void;
  persistent?: boolean;
  onImported?: (entries: Entry[]) => void;
}) {
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
      </fieldset>
      <label className="settings-lock" htmlFor="auto-lock">
        闲置后锁定
        <select
          id="auto-lock"
          value={minutes}
          onChange={(event) =>
            onMinutes(Number(event.target.value) as AutoLockMinutes)
          }
        >
          <option value={1}>1 分钟</option>
          <option value={5}>5 分钟</option>
          <option value={15}>15 分钟</option>
          <option value={0}>不自动锁定</option>
        </select>
      </label>
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
