# 项目结构

应用由 Tauri 桌面程序和 Chromium 浏览器扩展组成。界面使用 React / TypeScript，密码库、窗口和剪贴板由 Rust 管理。

| 路径 | 内容 |
| --- | --- |
| `src/` | 主窗口、悬浮轮盘、账号编辑、设置与主题 |
| `src-tauri/src/` | Tauri 命令、密码库、窗口布局、剪贴板及浏览器连接 |
| `extension/` | Edge / Chrome Manifest V3 扩展 |
| `tests/` | React 交互测试 |
| `scripts/` | 构建、检查与浏览器测试 |
| `docs/` | 使用与开发文档 |

## 密码库

前端通过 Tauri IPC 调用 `VaultService`，由服务统一检查解锁状态、闲置时间和会话编号，再交给 `Vault` 读写加密文件。

列表只读取账号元数据。显示密码、复制、导入和导出各自使用独立命令。保存成功后广播 `lime-vault-changed`，通知窗口刷新列表。

`vault.rs` 负责加密、数据校验与原子保存；`vault_service.rs` 负责会话、锁定和并发检查。格式见 [密码库设计](vault.md)。

## 悬浮窗

`Floating.tsx` 管理轮盘、搜索和面板，`floating_layout.rs` 管理尺寸、拖动及贴边动画，`placement.rs` 保存位置。

连续粘贴由 `quick_paste.rs` 处理：用户选择账号后复制用户名，最多等待 20 秒的 Tab，再复制密码。剪贴板清理由 `clipboard.rs` 按序号判断，避免清除后来复制的内容。

## 浏览器扩展

通信路径为：内容脚本 / 插件工具栏 → 扩展后台 → Native Messaging host → 本机桥接 → `VaultService`。

- `suggestions.js` 显示登录框建议，`fill.js` 识别并填写目标表单。
- `capture.js` 在用户提交表单时收集保存候选，显示确认面板。
- `background.js` 检查来源、标签页和文档，管理短期保存提示。
- `browser_bridge.rs` 负责本机通信、扩展部署和网址匹配。
- `bin/lime-browser-host.rs` 连接扩展与桌面程序。

浏览器提交的候选密码暂存在 Rust 内存中；用户确认后才写入密码库。更新会再次核对原账号，避免覆盖期间发生的修改。网站排序使用主机和路径，最近选择保存在加密的 `browser_preferences` 中。
