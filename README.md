# 直到密码变成一颗酸橙

Windows 个人密码工具，以课程设计为起点，逐步按开源项目标准打磨。Rust + Tauri 2 + React + TypeScript，橙色主题、桌面悬浮轮盘和本地加密密码库。

[下载 1.0.0](https://github.com/Yuzi-jami/until-a-lime/releases/tag/v1.0.0) · [版本说明](docs/release-1.0.md) · [安装说明](docs/install.md)

## 功能

- 本地加密收藏室：主密码解锁、搜索、收藏、编辑、删除撤销、密码强度统计。
- 橙子悬浮轮盘：搜索账号、快速保存、打开收藏室、锁定；拖动图标移动，贴边半隐藏。
- 普通应用连续复制：选择账号复制用户名，20 秒内按 Tab 准备密码，再由用户粘贴；仅适用于允许复制粘贴的输入框。
- Edge / Chrome 扩展：HTTPS 登录输入框自动建议，用户选择账号后填写，支持 iframe 和同站子域匹配。
- 保存小窗与二级密码生成器；已有相同账号时显式选择更新或另存。
- 浏览器 CSV 导入、分类建议与批量分组、加密备份导入导出、修改主密码。
- 浅色 / 深色主题、自定义闲置锁定、托盘、单实例和有效会话内免重复解锁。

## 安装和使用

在版本页下载 `Until-a-lime_1.0.0_x64-setup.exe`，以当前 Windows 用户安装。需要 WebView2；缺少运行时时安装器会联网下载微软引导程序。安装包未签名。

首次进入收藏室时设置主密码；主密码不保存，遗忘无法恢复。关闭主窗口会隐藏到后台，有效会话内再次打开无需重复输入；手动锁定、闲置到期或完全退出后需要重新验证。

普通应用填写：悬浮窗搜索并选择账号 → Ctrl + V 粘贴用户名 → 20 秒内按 Tab → Ctrl + V 粘贴密码。工具不自动输入、不自动提交；QQ 等受保护输入框不适配。

浏览器填写：在设置中准备浏览器扩展，再在 Edge / Chrome 扩展管理页确认加载文件夹。首次安装必须手动确认，后续 HTTPS 登录输入框可自动显示建议。扩展版本独立为 0.2.0，尚未上架商店。详见 [浏览器扩展说明](docs/browser-extension.md)。

数据通常位于 `%APPDATA%\dev.untilalime.desktop\vault.lime`，以 Tauri 为准。升级保留应用标识和数据路径；请先通过设置导出加密备份，再从托盘退出旧实例。Debug / Release 共用密码库和单实例标识。

## 开发和构建

需要 Windows、Node.js 24、Rust MSVC、Visual Studio C++ 工具、Windows SDK 和 WebView2。

```powershell
npm ci
pwsh -NoProfile -File scripts/Check-Desktop.ps1
npm run tauri -- build
```

安装包生成到 `target/release/bundle/nsis/`。不打包安装器时使用 `npm run tauri -- build --no-bundle`。Debug 构建使用 `npm run tauri -- build --debug --no-bundle`，独立启动使用 `scripts/Start-LimeDesktop.ps1`；发行程序使用 `-Configuration Release`。两种程序均使用 GUI 子系统，不依赖构建终端或 Vite 存活。

网页预览运行 `npm run dev`，仅展示内存中的虚构资料。测试只使用虚构记录和临时密码库；历史 `crates/windows-validation` 和输入探测脚本不属于常规开发检查，不运行旧 UIA / SendInput 实验。

## 文档和验证范围

- [1.0 版本说明](docs/release-1.0.md)、[实际验收记录](docs/acceptance-report.md)
- [本地密码库](docs/vault.md)、[CSV 导入](docs/browser-csv.md)、[快速保存与分类](docs/quick-save-and-categories.md)
- [工作交接总结](docs/handoff.md)、[阶段计划](docs/plan.md)、[贡献指南](CONTRIBUTING.md)
- [UI 设计](docs/ui-design.md)、[当前架构](docs/architecture.md)、[安全范围](SECURITY.md)

1.0 是个人使用与课程设计里程碑，未经过独立安全审计。自动检查覆盖前端交互模型、密码库加密与失败原子性、会话授权和浏览器 DOM 模型，不代表全部真实网站或原生环境兼容。安装、升级、卸载及完整键盘 / 屏幕阅读器体验仍待独立人工验收。

系统锁屏联动、受保护输入框、安卓、同步和多设备不在当前范围内。项目所有者尚未选定开源许可证；代码可见性不等于授予再分发许可。公开开源前的许可证与素材事项见 [草案](docs/license-draft.md)。

