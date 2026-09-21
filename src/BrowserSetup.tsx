import { useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";

export default function BrowserSetup() {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function setup() {
    setBusy(true);
    try {
      setMessage(await invoke<string>("browser_install"));
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="browser-setup">
      <div className="eyebrow">BROWSER / CONNECTION</div>
      <h2>把收藏带到浏览器。</h2>
      <p>
        为 Edge 和 Chrome
        安装酸橙扩展。打开登录页，点击扩展中的账号即可填写；不会自动提交。
      </p>
      <ol>
        <li>点击下方按钮准备扩展与本机连接组件。</li>
        <li>
          在 Edge 的 edge://extensions 或 Chrome 的 chrome://extensions
          打开开发者模式，选择“加载解压缩的扩展”，选择准备好的 extension
          文件夹。
        </li>
        <li>
          回到收藏室验证主密码。在网站先打开登录框，再点击浏览器工具栏的酸橙图标，或按
          Alt + Shift + L，选择账号填写。Tab 只切换输入框，不触发填写。
        </li>
      </ol>
      <button
        className="primary"
        disabled={busy || !isTauri()}
        onClick={() => void setup()}
      >
        {busy ? "正在准备…" : "准备浏览器扩展"}
      </button>
      <p>
        首次使用必须完成浏览器扩展加载；已有扩展更新后，请在扩展管理页点击“重新加载”。快捷键如被占用，可在浏览器扩展快捷键设置中修改。
      </p>
      <button
        className="secondary"
        disabled={busy || !isTauri()}
        onClick={() => {
          setBusy(true);
          void invoke("browser_disconnect")
            .then(
              () =>
                setMessage(
                  "浏览器连接已关闭，下次启动也不会启用。可在浏览器扩展管理页移除扩展。",
                ),
              (e) => setMessage(String(e)),
            )
            .finally(() => setBusy(false));
        }}
      >
        断开浏览器连接
      </button>
      {message && (
        <p className="selected-file" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
