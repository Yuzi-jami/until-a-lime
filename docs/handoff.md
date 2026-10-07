# 开发交接总结

更新：2026-10-07。项目为 Windows 个人密码工具“直到密码变成一颗酸橙”，Rust + Tauri 2 + React + TypeScript。桌面版本 1.0.0，浏览器扩展独立版本 0.2.0；不要重新选型或另建密码库。

GitHub：`Yuzi-jami/until-a-lime`，保持私有。首发 [v1.0.0](https://github.com/Yuzi-jami/until-a-lime/releases/tag/v1.0.0) 对应提交 `667c1d5d9308a2d6ddcb9b3171e9ea1134964e23`，包含安装包与校验文件。收尾后的 main 可包含文档和构建配置维护提交，发布标签与安装包不随之改写。

## 当前行为

- 本地加密收藏室：创建 / 解锁、搜索、收藏、增删改、删除撤销、强度统计、备份 / 恢复 / 改密和浏览器 CSV 导入。
- 默认按需验证：进入普通入口无需密码，首次访问账号时验证；关闭只隐藏，未到期会话恢复无需重复输入。手动锁定、闲置到期、完全退出后重新验证。
- 橙色无叶子图标、悬停旋转、直接拖动、贴边半隐藏；主窗交通灯与右上角隐藏式 Windows 按钮并存。
- 悬浮窗内搜索账号并连续复制：先复制用户名，20 秒内按 Tab 再复制密码，由用户自行粘贴；无用户名记录直接复制密码。无输入模拟或自动提交。
- 悬浮快速保存，生成器位于二级面板；重复账号显式选择更新或另存。分类默认留空归未分类，完整下拉可选 / 新建，网站建议显式采用。
- 分类分为建议和手动两个页面，支持预览、多选、整批原子提交和详情快捷换组；旧账号不会因升级自动重新分类。
- Edge / Chrome HTTPS 登录建议、iframe、同站域匹配、Native Messaging 和后台恢复；首次加载或新增权限仍需浏览器确认，锁定不会自动解锁。
- 浅深色、自定义闲置 1–1440 分钟（另可关闭）、托盘、单实例、位置记忆。闲置状态以 Rust 服务为准。

## 代码与文档导航

| 文件 | 职责 |
| --- | --- |
| src/VaultRoot.tsx、src/App.tsx | 主窗口验证、收藏室与元数据交互 |
| src/Floating.tsx、src/QuickSave.tsx、src/GeneratorPanel.tsx | 悬浮状态、快速保存、二级生成器 |
| src/CategoryPicker.tsx、src/CategoryOrganizer.tsx、src/QuickGroup.tsx | 分类选择、批量整理、详情换组 |
| src/categories.ts、src/category-catalog.ts | 本地分类规则与公共域名库 |
| src-tauri/src/lib.rs、floating_layout.rs、placement.rs | IPC、托盘、窗口、拖动、吸附与位置 |
| src-tauri/src/vault.rs、vault_service.rs | 加密、数据提交、会话、授权和票据 |
| src-tauri/src/quick_paste.rs、clipboard.rs | 20 秒一次性 Tab 等待与剪贴板序号清理 |
| src-tauri/src/browser_bridge.rs、browser_protocol.rs、bin/lime-browser-host.rs | 浏览器桥接、同站授权与本机 host |
| extension/ | Manifest V3 后台、输入框建议与填写 |
| scripts/Check-Desktop.ps1、.github/workflows/desktop.yml | 本机统一检查与 Windows CI |

当前 [架构](architecture.md)、[密码库](vault.md)、[保存与分类](quick-save-and-categories.md)、[浏览器扩展](browser-extension.md) 和 [计划](plan.md) 是接手入口。验收记录按日期追加，以最新段落为准；[旧交接](history/handoff-2026-09-20.md) 和旧原型仅用于历史追溯。

## 数据与范围约束

identifier 保持 `dev.untilalime.desktop`；真实库通常在 `%APPDATA%\dev.untilalime.desktop\vault.lime`，不读取、解密、改写或上传。测试只用虚构数据及临时目录。Debug / Release 共用库与单实例标识；不强制终止可能含草稿的旧实例。

保持 `LIMEV001`、Argon2id / XChaCha20-Poly1305 约定及原子提交；锁定推进 epoch，过期请求拒绝。main 承载管理操作；floating 的搜索、保存和连续复制走专用受限命令，不能从前端批量读取已有密码。

不恢复 QQ 等保护输入框适配、历史 windows-validation / UIA / SendInput 实验；不加系统锁屏联动、安卓或同步。课程作业交给独立对话，本对话只负责开发与上传。

## 证据和剩余事项

2026-10-06 本地前端 67 项、Rust 42 项检查通过，前端构建、格式、Clippy all-targets 和 NSIS 构建通过。GitHub 首发 CI 在干净 Windows 检出时遇到 CRLF 格式差异；2026-10-07 收尾在 .gitattributes 固定文本 LF，实际远端复核结果见 [验收记录](acceptance-report.md)。

安装包未签名，独立安全审计、独立安装 / 升级 / 卸载、全部真实网站兼容、完整 DPI / 读屏验收尚未完成。许可证与素材确认尚待所有者决定，未授予开源许可。不要把这几项写成已通过，也不要以此重新开发已经交付的功能。
