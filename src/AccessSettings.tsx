import { useState } from "react";
import { readPreference } from "./usePreferences";

export function startupVerification() {
  return readPreference("lime.accessMode") === "startup";
}

export default function AccessSettings() {
  const [startup, setStartup] = useState(startupVerification);
  return (
    <fieldset className="access-settings">
      <legend>主密码验证方式</legend>
      <label>
        <input
          type="radio"
          name="access-mode"
          checked={!startup}
          onChange={() => change(false)}
        />
        按需验证（推荐）
      </label>
      <label>
        <input
          type="radio"
          name="access-mode"
          checked={startup}
          onChange={() => change(true)}
        />
        启动时验证
      </label>
      <p>
        按需模式可直接打开软件。查看、修改、删除、导入或填写密码库时先验证一次，有效会话内不重复验证。手动锁定、闲置到期或退出后失效。
      </p>
    </fieldset>
  );
  function change(value: boolean) {
    setStartup(value);
    try {
      localStorage.setItem("lime.accessMode", value ? "startup" : "on-demand");
    } catch {
      /* Optional preference. */
    }
  }
}
