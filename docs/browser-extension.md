# Edge / Chrome 扩展（本地预览版）

2026-09-20。实现 Manifest V3 扩展与 Native Messaging 本机组件。尚未商店发布，不能绕过浏览器安装确认，也不能声称所有网站兼容。

## 使用

1. 安装本轮构建的新安装包，启动酸橙。在设置或未验证首页点击“浏览器扩展”→“准备浏览器扩展”。此操作向当前用户 HKCU 注册 `dev.untilalime.browser`（Chrome、Edge），写入本机连接文件，列出扩展文件夹路径。不提权，不修改浏览器策略。
2. 打开 `edge://extensions` 或 `chrome://extensions`，打开开发者模式，选择“加载解压缩的扩展”，选择提示的 `extension` 文件夹。浏览器确认不可省略。商店版需要所有者后续提交、审核与正式安装链接，本轮不公开发布。
3. 在收藏室输入一次主密码，确保账号网址与登录页面 HTTPS origin（协议、主机、端口）一致。例如 `https://accounts.example.com/login` 不匹配 `https://example.com`。无协议的网址按 HTTPS 处理。
4. 打开普通 HTTPS 登录页面，点击扩展图标或按 **Alt + Shift + L**，选择账号；自动填用户名和密码，不自动回车或提交。锁定时先回收藏室验证，再点扩展“刷新账号”。
5. 关闭连接可点击“断开浏览器连接”，立即拒绝新请求并清除启用偏好；如需移除扩展，到浏览器扩展管理页操作。断开不会删除用户密码库，保留安装注册供重新连接。

只有一个可见密码框且用户名框可唯一识别才填写；注册/改密表单、跨域表单 action、iframe、HTTP、内部页、已有不同用户名或已有密码、目标变更、10 秒过期均拒绝。多步登录、Shadow DOM 和复杂网站可能需要手动复制。不会访问用户日常浏览器数据目录，也不导出其浏览记录。

## 权限与通信

扩展仅有 activeTab、scripting、nativeMessaging；无 `<all_urls>` 常驻授权、自动监听或扩展存储密码。用户点击后获得当前标签权限，限定顶层 documentId，填写前再次核验当前 URL、表单元素身份和短期票据。

本机 host 只接受固定扩展 ID 来源，以长度前缀 stdio 接入；转发至 127.0.0.1 随机端口，使用每次应用启动新生成的 256 位 token。无 HTTP/CORS 服务。请求上限 256 KiB，连接读写有时限。后端再次检查 Rust 会话、闲置截止时间、操作类型和精确 HTTPS origin；列表没有密码，显式 fill 只返回所选账号。锁定后不接受后续读取，不能撤回已传入网页的密码。

连接配置通常在 `%APPDATA%\dev.untilalime.desktop\browser-bridge.json`，依赖当前用户目录 ACL；没有保存主密码/解密密钥。同一 Windows 用户下的恶意进程可读取连接 token，这不是防御已被控制的本机用户会话；固定扩展 ID 也不是对本地恶意进程的身份认证。CSV/IPC/网页运行时副本无法保证完全擦除。密码提交给网页后该网页脚本可以读取它，这是填表本身的权限边界。

## 构建

`npm.cmd run browser:prepare` 构建 host；Tauri 会将同一 Cargo 包的额外二进制随安装包分发。`npm.cmd run tauri -- build` 自动运行前端构建和 host 准备，NSIS 包含 `lime-browser-host.exe`。开发检查可直接运行 `cargo test -p until-a-lime --locked`，或运行 `scripts/Check-Desktop.ps1`。不要使用旧安装包测试新扩展。

manifest 的公钥固定开发扩展 ID，不含私钥；商店发行的 ID 若不同，需更新 manifest、host 来源白名单及配置，并重新构建。当前运行链路与 DOM 模型有测试，但 Edge/Chrome 安装、权限提示、真实网站登录尚待实测，见验收报告。

## xcpcai.com 与快捷键

2026-09-20 已只读检查 `https://xcpcai.com/`：先点页面 **Sign in**，会出现登录弹窗，包含 name=username 的文本框和 name=password 的密码框；两个字段同属本站 form。检查时未登录、未读取或输入用户凭据。

Tab 仅切换输入框，不触发扩展。正确顺序：酸橙收藏室验证 → 站点打开 Sign in 弹窗 → Alt + Shift + L（或工具栏酸橙图标）→ 选择账号。记录网址填写 `https://xcpcai.com`。快捷键被占用可在 `chrome://extensions/shortcuts` 或 `edge://extensions/shortcuts` 中修改。

更新到扩展 0.1.1 后：在桌面再次点“准备浏览器扩展”更新扩展文件，浏览器扩展管理页点“重新加载”，之后新快捷键与逐字段事件修复才生效。首次使用仍须完成“加载解压缩的扩展”，只有安装桌面软件不会自动装入浏览器扩展。

表单填写现在逐个设置并通知 React，避免用户名更新时把密码恢复为空；若重绘更换了密码框则取消，防止继续向失效目标传值。xcpcai 的实际表单属性已核查，相应 DOM/受控重绘模型通过测试仍不等于真实账户登录验证。
