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
        安装酸橙扩展后，点击网站登录输入框就会显示账号建议，选择账号即可填写；不会自动提交。
      </p>
      <ol>
        <li>点击下方按钮准备扩展与本机连接组件。</li>
        <li>
          在 Edge 的 edge://extensions 或 Chrome 的 chrome://extensions
          打开开发者模式，选择“加载解压缩的扩展”，选择准备好的 extension
          文件夹。
        </li>
        <li>
          回到收藏室验证主密码。之后直接点击网站登录输入框，选择酸橙账号建议即可填写；也可以点工具栏图标或按
          Alt + Shift + L。
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
        只需首次准备和加载，连接偏好会保留，浏览器使用时可自动在后台启动酸橙。密码库锁定时仍需验证主密码，无需每次点“准备浏览器扩展”。
      </p>
      <p>
        本次升级到 0.2.0 后，在扩展管理页重新加载一次，并允许扩展访问 HTTPS
        网站，再刷新已打开的登录页。以后新打开的页面自动生效。
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
