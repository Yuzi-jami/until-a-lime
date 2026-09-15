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

下一阶段：原生全流程手动验收、键盘/屏幕阅读器验收和独立安全审计；再进行受控快捷填写。系统锁屏联动按要求不接入。当前不向其他应用自动输入。

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
