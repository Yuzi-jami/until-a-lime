# 本轮实施与验收记录

## 范围与基线

日期：2026-09-15，Asia/Shanghai。工作区 `E:\直到密码变成一颗酸橙`。Windows NT 10.0.22631.0；Node 24.15.0、npm 11.12.1、rustc 1.98.1 (48a229cea 2026-09-01)、cargo 1.98.1，MSVC 桌面构建。MSRV 未验证。

Git 分支 main，基线 `307ebb72f414c22493efbc5e49c80da4a73bcf68`（Update plan.md）；开始时工作树干净。未提交、未推送。已核对项目及 E:\ 上级，无适用 AGENTS.md。已阅读 handoff、plan、vault 和事件记录。

P0 已验收；P1 实现完成待原生验收；P2 自动化及所发现缺陷修复完成，原生验收未完成；P3 工程材料、干净副本构建和安装包生成完成，安装体验未验收；C0 纯逻辑完成；C1 未启动。

未读取、修改或用于测试真实密码库。Rust 测试使用临时目录与虚构数据；没有启动桌面应用、安装/卸载或执行旧输入原型。没有引入系统锁屏联动、输入注入、扩展窗口权限或修改加密格式。

## 变更清单

| 文件 | 改动目的 / 边界 |
| --- | --- |
| src-tauri/src/main.rs | Windows debug/release 均为 GUI 子系统 |
| scripts/Start-LimeDesktop.ps1、Test-LimeLifecycle.ps1 | 默认 Debug，支持 Release；继续按实际路径/PID定位 |
| scripts/Inspect-LimeBinary.ps1 | 只读 PE 子系统、时间和哈希检查 |
| src-tauri/src/vault.rs、vault_service.rs | 创建/恢复先准备，再在 epoch 检查后提交；过期清除导入票据；增加取消提交回归 |
| src/style.css | 减少动态效果时禁用动画/过渡，长标题和备注换行 |
| scripts/Check-Desktop.ps1、.github/workflows/desktop.yml | fail-fast 桌面检查、Windows CI；不执行历史 crate |
| src-tauri/tauri.conf.json | 单一 NSIS、currentUser、WebView2 引导下载；identifier/CSP/窗口权限不变 |
| .gitignore | 忽略 .lime、.lime.bak、个人验收目录，恢复副本由 *.lime 覆盖 |
| package.json、scripts/quickfill-model.mjs、quickfill-model.test.mjs | 加入 7 项无副作用 C0 测试；没有产品接入 |
| README、docs/architecture.md、docs/plan.md | 构建运行说明、当前架构、实际阶段状态 |
| CONTRIBUTING、SECURITY、docs/course-demo.md | 贡献、安全反馈待配置、课程演示和局限 |
| docs/install.md、compatibility.md、license-draft.md、dependency-licenses.json、quickfill-design.md | 安装、兼容性、许可草案与依赖元数据、填写设计 |

## 自动检查

以下均为本轮实际结果，日期均为 2026-09-15。完整本地输出在 `.acceptance/`（忽略提交）；表格保留可审查摘要。

| 命令 | 退出码 | 实际结果 / 日志 |
| --- | --- | --- |
| npm.cmd run format:check | 0 | 基线及最终通过；baseline-0.log / final-checks.log |
| npm.cmd test | 0 | 基线 React 9 + Node 6；最终 React 9 + Node 13（含 C0 7 项），无失败 |
| npm.cmd run build | 0 | TypeScript + Vite 成功 |
| cargo fmt --all -- --check | 0 | 基线及最终通过；仅格式扫描历史 crate，未运行它 |
| cargo clippy -p until-a-lime --locked -- -D warnings | 0 | 基线、最终和新增会话测试后均通过；final-clippy.log |
| cargo test -p until-a-lime --locked | 0 | 基线 15，首轮修复 16，最终 17；session-tests.log；main/doc tests 均 0 项 |
| scripts/Check-Desktop.ps1 | 0 | 六项检查逐一检查退出码，整套通过；随后仅新增 Rust 测试，已补 Rust 检查 |
| npm.cmd run tauri -- build --debug --no-bundle | 0 | debug 独立 EXE 成功，见产物表 |
| npm.cmd run tauri -- build --no-bundle | 0 | release 独立 EXE 成功；release-build.log |
| npm.cmd run tauri -- build | 1 → 0 | 首次 NSIS 下载被套接字权限拒绝；获准联网重试成功，nsis-build-retry.log |
| npm.cmd audit --json | 1 → 0 | 首次访问受限；获准重试，报告 0 项漏洞（不是安全认证） |
| cargo audit --version | 101 | 未安装 cargo-audit，Rust 漏洞数据库审计未执行；不是“无漏洞” |
| cargo metadata --locked --format-version 1 | 101 | 全平台元数据尝试下载失败；改为 Windows filter-platform、获准联网后退出 0，生成桌面依赖许可证元数据 |
| npm.cmd ci --prefix '.acceptance/clean source 中文' --offline --no-audit | 0 | 从 Git 跟踪与新文件复制源码；独立 node_modules，使用缓存，无锁文件升级 |
| 干净副本 npm.cmd run build / npm.cmd run tauri -- build --no-bundle | 0 / 0 | 中文和空格路径构建成功；复用根目录 CARGO_TARGET_DIR 编译缓存，不是全空缓存安装证明 |
| Inspect-LimeBinary.ps1 -Configuration Debug / Release | 0 / 0 | 两个 EXE 均为 PE subsystem 2（Windows GUI） |
| PowerShell Parser / git diff --check | 0 / 0 | 启动、生命周期、检查脚本语法通过；差异无空白错误 |
| Get-AuthenticodeSignature 安装包 | 0 | NotSigned |

基线全部六项通过。PowerShell 初次源码编辑因默认 GBK 解码中止，随即显式 UTF-8 修正并经最终检查；未当作产品缺陷。进程 CIM 查询被系统拒绝，未据此声称验证了父子进程；Get-Process 未返回本项目实例。

## 已修复问题与证据

1. **debug 伴生控制台**：原入口仅非 debug 启用 GUI 子系统；改为 Windows 全构建启用。debug/release 实际 PE 为 2。资源管理器双击、可见控制台及关闭调用终端后的行为尚未验证。
2. **锁定后创建/恢复仍可能写磁盘**：旧流程先调用带写入的 create/restore，再检查 epoch。若 KDF 期间锁定，结果虽拒绝解锁，文件已可能创建/恢复。现分离 prepare/commit，服务持锁检查 epoch 后才写盘。创建测试确认无新库；恢复测试确认原密文不变、无恢复归档副本。另补改密/导入期间锁定的磁盘不变和不可读测试。
3. **闲置过期残留导入票据**：check/access/begin_sensitive 的过期路径现在同步清除 import_file。测试确认超时后票据为空且读取失败。没有把残留票据单独宣称为已证实的权限绕过。
4. **减少动态效果 / 长文本**：CSS 局部完善。没有执行屏幕视觉检查，不宣称全部布局或读屏通过。

静态复核：CloseRequested 仍只 prevent_close、保存位置和 hide；未销毁 WebView。托盘退出仍 lock_all，后台每秒检查仍保留。该复核不能替代 SESSION 原生用例。

## 原生检查

当前可用 CUA 明确禁用原生应用控制；没有隔离 Windows 测试用户/虚拟机供本轮安装和密码库业务验收。以下未执行不代表通过。没有用 DOM、PE、编译或 mock IPC 代填。

| 编号 | 构建 / 实际操作 | 结果 |
| --- | --- | --- |
| START-01 | debug 双击、观察控制台 | 未执行；仅 PE=2 |
| START-02 | release 双击、独立启动 | 未执行；仅构建和 PE=2 |
| START-03 | 关闭调用终端后应用存活 | 未执行 |
| START-04 | 重复启动保留原 PID | 未执行 |
| START-05 | 中文/空格路径原生启动 | 未执行；中文/空格源码构建通过不能替代 |
| START-06 | 托盘退出全部窗口与进程 | 未执行 |
| SESSION-01 | 关闭闲置，隐藏恢复 3 次 | 未执行 |
| SESSION-02 | 1 分钟到期前恢复 | 未执行 |
| SESSION-03 | 隐藏超过期限、后台拒绝秘密 | 未执行；Rust 超时逻辑测试通过 |
| SESSION-04 | 前台超时清除敏感展示 | 未执行 |
| SESSION-05 | 侧栏/轮盘/托盘锁定 | 未执行 |
| SESSION-06 | 完全退出重启需主密码 | 未执行 |
| SESSION-07 | 隐藏时重复启动保留会话 | 未执行 |
| SESSION-08 | 原生认证/改密/导入期间锁定 | 未执行；临时目录 Rust 回归通过 |
| DATA-01 | 原生首次创建/确认/边界/取消 | 未执行；React 与 Rust 自动测试仅部分逻辑覆盖 |
| DATA-02 | 原生增删改收藏撤销及重启 | 未执行 |
| DATA-03 | 原生正确/错误主密码 | 未执行；Rust 加密库覆盖 |
| DATA-04 | 改密并原生重开 | 未执行；Rust 改密覆盖 |
| DATA-05 | 原生导出、取消、已有路径 | 未执行；核心拒绝覆盖测试通过 |
| DATA-06 | 原生空库导入与追加 | 未执行；核心导入测试通过 |
| DATA-07 | 原生选择器期间锁定、旧票据 | 未执行；取消导入和票据清除自动测试通过 |
| DATA-08 | 原生备份恢复 | 未执行；核心恢复测试通过 |
| DATA-09 | 原生错误显示 | 未执行；临时目录损坏/超大/写入失败/并发修改测试通过 |
| DATA-10 | 原生显示/复制后锁定及剪贴板改写 | 未执行，未读取或改变实际剪贴板 |
| UI | 主题、760×620、长字段、键盘与弹窗焦点 | 原生未执行 |
| DISPLAY | 100/125/150/200%、跨屏/边缘/断屏 | 原生未执行；几何函数测试不是多屏实测 |
| A11Y | Windows Narrator | 未执行 |
| INSTALL | 安装、启动、覆盖升级、卸载、保留库 | 未执行；仅安装包生成与签名检查 |

## 剩余问题与交接

- **验收阻断**：START/SESSION/DATA 原生矩阵仍未执行。最终验收者应在隔离用户或虚拟机使用虚构库逐项操作，优先关闭恢复和超时、原生对话框、剪贴板所有权；不要拿真实库做故障注入。
- **发布前必需**：Rust 漏洞数据库审计、许可证文本/NOTICE 审阅及图标来源确认尚未完成。依赖 JSON 只是锁定版本元数据；许可证草案未授权代码，安全联系方式待配置。
- **安装风险未定**：WebView2 缺失时引导下载、升级、卸载保留数据和 SmartScreen 表现未验证。未签名且未公开发布，安装包仅供审查。
- **覆盖限制**：MSRV、干净系统工具安装、DPI/多屏、Narrator、完整视觉和焦点流程未执行。CI 仅提交配置，未在远程运行。
- **后续范围**：C0 仅假目标纯逻辑，不证明能识别 Windows 输入框或消除焦点竞态；Edge/Chrome/Steam/微信未验证，QQ 保护输入框排除，C1 未执行。

重点复核 vault.rs/vault_service.rs 的准备与提交边界、main.rs 的 PE 属性及实际启动、启动脚本配置、NSIS 配置和此报告。加密参数、identifier、CSP、capability 保持原边界。计划允许环境限制下先提交 PE/自动化证据，本轮没有把这部分替代原生最终验收。

## 构建产物

所有路径均在当前工作区。哈希与时间见下表；EXE 和安装包均未启动/安装。release 产物经 NSIS bundle 标记后哈希可能与之前 no-bundle 构建不同。末次仅新增 cfg(test) 回归与文档，不改变产品运行逻辑。

| 产物绝对路径 | 本地构建时间 | 字节 | SHA-256 |
| --- | --- | --- | --- |
| `E:\直到密码变成一颗酸橙\target\debug\until-a-lime.exe` | 2026-09-15T21:59:01 | 14280704 | `6335842ed70fd2027c05dfb0fafe953af64539b62cfc4cd4040f02a9befe95c7` |
| `E:\直到密码变成一颗酸橙\target\release\until-a-lime.exe` | 2026-09-15T21:56:25 | 9389568 | `528db4445cd80f288cf80e33dea5c9c8ea7e1a0270b9b5aa3b0ca66d2e86b9d8` |
| `E:\直到密码变成一颗酸橙\target\release\bundle\nsis\直到密码变成一颗酸橙_0.1.0_x64-setup.exe` | 2026-09-15T21:56:23 | 2118957 | `09c65aee30c0312dbaa30d372d0ce8cd4ef7cc71f1067c2f12853d1b58498c2b` |
