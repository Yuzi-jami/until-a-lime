# 直到密码变成一颗酸橙

Windows 个人密码工具，以课程设计为起点，逐步按开源项目标准打磨。Rust + Tauri 2 + React + TypeScript，橙色主题、桌面悬浮轮盘和本地加密密码库。

当前本地加密密码库及数据维护核心已实现，接下来补齐启动体验、原生验收与工程交付。接手开发请先读 [工作交接总结](docs/handoff.md) 和 [详细阶段计划](docs/plan.md)；格式、数据保护边界和测试范围见 [密码库说明](docs/vault.md)。QQ 保护输入框和旧填写原型仍暂停，蓝屏根因未确认。

## 开发和运行

需要 Windows、Node.js 24、Rust MSVC、Visual Studio C++ 工具、Windows SDK 和 WebView2。

```powershell
npm ci
npm test
npm run build
cargo test -p until-a-lime --locked
cargo clippy -p until-a-lime --locked -- -D warnings
npm run tauri -- build --debug --no-bundle
pwsh -NoProfile -File scripts/Start-LimeDesktop.ps1
```

网页预览运行 `npm run dev`，仅显示虚构数据。桌面版首次创建空密码库，由你设置主密码；主密码不保存，遗忘无法恢复。当前开发版未经过独立安全审计，请先用测试账号体验，并保留其他备份。

## 已实现

- 独立置顶轮盘，直接拖动橙子、位置记忆、托盘和单实例恢复。
- 主密码创建/解锁，本地账号加密保存，编辑、收藏、删除及短时撤销。
- 搜索、按需显示密码、复制后定时清理、生成器和主题设置。
- Rust 后台锁定检查、原子写入、上次密文备份与恢复。

下一阶段：原生全流程手动验收、键盘/屏幕阅读器验收和独立安全审计。浏览器扩展和 Steam 单项填写已有实现，原生兼容性待验收，详见下方功能增量。系统锁屏联动按要求不接入。

## 文档

- [工作交接总结](docs/handoff.md)
- [当前阶段计划](docs/plan.md)
- [本地密码库](docs/vault.md)
- [桌面交互和历史验证记录](docs/desktop-preview.md)
- [UI 设计](docs/ui-design.md)
- [架构](docs/architecture.md)
- [早期可行性记录](docs/feasibility.md)
- [蓝屏事件记录](docs/incident-2026-09-10.md)

`crates/windows-validation` 为独立历史实验，默认 Cargo 目标已切换为桌面工程。不要将旧输入验证脚本作为本项目常规测试入口。公开发布前还需完成许可证选择、贡献指南和安全反馈流程。

## 基础交付构建

统一检查：`pwsh -NoProfile -File scripts/Check-Desktop.ps1`。debug：`npm.cmd run tauri -- build --debug --no-bundle`；release：`npm.cmd run tauri -- build --no-bundle`。启动脚本默认 Debug，发行版使用 `scripts/Start-LimeDesktop.ps1 -Configuration Release`；生命周期脚本支持相同参数，仅核验隐藏与单实例，不证明仍解锁。独立 EXE 不依赖 Vite，关闭自行打开的构建终端不会主动退出独立启动的应用。debug/release 均使用 GUI 子系统，运行时终端诊断不可保证可见，构建诊断仍在构建终端。

数据通常位于 `%APPDATA%\dev.untilalime.desktop\vault.lime`，以 Tauri 为准。请通过设置导出加密备份，遗忘主密码不能找回。改密前备份可能仍用旧密码。安装方式与限制见 [安装说明](docs/install.md)，实际结果见 [验收报告](docs/acceptance-report.md)。

干净构建：复制已跟踪源码及锁文件到新目录，运行 npm ci，再运行统一检查和 release 构建。当前测试工具链为 Node 24.15.0 / npm 11.12.1 / Rust 1.98.1；未验证 MSRV，workspace 的 1.85 不代表桌面成员声明或实测最低版本。

## 2026-09 功能增量

默认按需验证：打开软件无需主密码，首次进入密码库时验证，有效会话内不重复验证；可在设置中选择启动验证。手动锁定、闲置到期、完全退出仍清除会话，账号列表在验证前不展示。

新增 [Edge/Chrome CSV 导入](docs/browser-csv.md) 和 [浏览器扩展安装与填写说明](docs/browser-extension.md)。扩展为未上架的本地预览版，需浏览器确认加载；功能按钮准备本机组件，不能静默安装扩展。前端视觉设计暂停，保持现有样式，等待用户设计。

浏览器填写：设置中点击“准备浏览器扩展”，在 Chrome/Edge 扩展管理页加载准备好的文件夹；已有扩展更新后需重新加载。在收藏室解锁后，打开网站登录框，点击工具栏酸橙图标或按 **Alt + Shift + L**，选择账号。**Tab 只切换焦点**。xcpcai.com 的公开登录框结构已核对，未进行真实凭据端到端填写。

Steam 单项填写（试用）：账号详情点击“准备填写用户名”或“准备填写密码”，30 秒内切到普通权限的 Steam，点击对应输入框，按下并松开 **Ctrl + Alt + P**。一次只经剪贴板粘贴所选字段，不自动登录；Esc、取消、锁定或超时结束请求。不能识别 Steam 内部具体字段，需手动选准焦点。实现、边界和未实测项见 [填写设计](docs/quickfill-design.md) 与 [验收报告](docs/acceptance-report.md)。
