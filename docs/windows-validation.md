# Windows 填写验证程序

这是架构验证用的独立 Rust 命令行程序，不是正式密码管理器。Tauri UI、密码库和浏览器扩展尚未实现。

## 支持的命令

```powershell
cargo run --locked -p windows-validation -- --probe-pid 12345
pwsh -NoProfile -File scripts/Test-WindowsValidation.ps1
```

`--probe-pid` 只报告指定 PID 的可访问顶层窗口数、Edit 控件数、密码控件数和 ValuePattern 支持数。请把示例 PID 替换为目标进程 PID。不会读取窗口标题、控件名称或输入内容。PID 不存在或窗口不可访问时可能返回 0 个窗口，这不代表应用不支持 UI Automation。

测试脚本先构建，再运行 `--self-test`，默认 30 秒超时。超时只终止该测试进程及它创建的子进程。首次编译和依赖下载不计入这 30 秒。直接运行二进制不带外部超时，第三方 UIA provider 卡顿时可能阻塞，初期建议通过脚本运行自测。

## QQ 专项探测

`scripts/Inspect-QqLogin.ps1` 提供 QQ 版本、签名状态和最多 5 次控件能力采样；默认 3 次，间隔 300ms，不读取 Name / Value。UIA 调用本身仍可能阻塞，采样次数不是超时限制。

Rust `--probe-pid` 现已额外复核控件类型、PID、启用、焦点、可见性和只读状态。各有一个可用密码/非密码框时只标记为候选，仍需验证应用身份与登录上下文；其他情况明确标记为不足或存在歧义，不要自动填写。ValuePattern 的存在不再单独作为可用性依据。

## 测试流程

1. 启动当前可执行文件自身的测试子进程，记录其 PID。
2. 子进程创建原生 Win32 测试窗口和两个 Edit 控件；密码框设置 ES_PASSWORD。
3. 父进程通过 COM / UI Automation 查找该 PID 的窗口及指定 AutomationId。
4. 每次填写前复核目标进程、窗口有效性及前台窗口快照；使用 ValuePattern 填写固定的虚构账号密码。
5. 子进程在自己的窗口内读取自己的虚构测试字段，仅向父进程返回验证是否成功，不返回密码。
6. 传入错误 PID 和失效前台快照，验证拒绝填写且字段没有变化。
7. 清理测试子进程。

为了不改变用户当前应用的焦点，测试窗口使用 WS_EX_NOACTIVATE / SW_SHOWNOACTIVATE。这里验证的是“前台状态保持不变”的条件，不能替代正式产品中“用户选定的目标窗口恢复到前台”的交互验证。

## 2026-09-10 实测

环境：Windows 11 build 22631，Rust 1.98.1，MSVC x64，windows crate 0.61.3。

```text
accessible_top_level_windows=1
edits=2 passwords=1 value_patterns=2
PASS: wrong process identity rejected without modifying dummy fields.
PASS: stale foreground snapshot rejected without modifying dummy fields.
PASS: Rust UI Automation filled and fixture verified both dummy fields.
```

构建与 Clippy 零警告检查通过。PowerShell 只读探测脚本修复了运行中程序没有窗口时不输出状态的问题。

## 限制与下一步

- 当前所有写入仅面向本程序刚创建的测试子进程，没有向任意 PID 填写的命令。
- UIA 检查和写入不是原子操作，仍存在状态变化的时间窗口；不能宣称已解决全部焦点竞争问题。
- 测试固定值不是密码库，代码也不是生产用凭据内存管理实现。
- 一次成功不代表覆盖所有控件、输入法、权限级别或客户端版本。
- QQ 9.9.27.45758 登录页已实测：能找到顶层窗口，但未获得可用密码框，暂不支持直接成对填写。Weixin 尚未验证登录页。不要为了测试退出尚未保存工作的应用。
- 后续增加真实登录页验证和浏览器桥接验证，再进入产品 UI 设计。微信若依赖扫码或手机确认，按该流程的实际能力确定范围。
