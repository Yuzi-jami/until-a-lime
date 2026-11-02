# 参与开发

欢迎提交问题、改进建议和 Pull Request。

反馈问题时，请写明应用版本、Windows 或浏览器版本、操作步骤和预期结果。界面问题可以附截图，表单问题可以附网站地址或一个可复现的示例页面。

## 开发环境

- Windows 10 / 11
- Node.js 24
- Rust stable，MSVC 工具链
- Visual Studio C++ Build Tools 和 Windows SDK
- WebView2

安装依赖并启动桌面开发模式：

```powershell
npm ci
npm run browser:prepare
npm run tauri -- dev
```

只调试网页界面时运行 `npm run dev`。网页模式使用示例数据；桌面模式连接本机密码库。

## 检查和构建

```powershell
pwsh -NoProfile -File scripts/Check-Desktop.ps1
npm run tauri -- build
```

检查脚本包含前端格式、测试与构建，以及 Rust 格式、Clippy 和测试。安装包生成在 `target/release/bundle/nsis/`。

## 提交修改

一个 PR 解决一个明确的问题，说明改动和验证方法。修复缺陷时尽量补上能复现问题的测试；涉及密码库格式时，说明旧数据如何读取。

示例、测试和截图请使用测试账号。开发版与安装版共用本机密码库，调试数据恢复或格式迁移时请使用独立的 Windows 测试用户。

代码入口见 [项目结构](docs/architecture.md)，加密与保存逻辑见 [密码库设计](docs/vault.md)。
