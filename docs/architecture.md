# 当前架构

2026-09-15。Rust + Tauri 2 + React + TypeScript。浏览器演示只用内存虚构数据；桌面 WebView 经 IPC 使用本地库。

React（VaultRoot/App/数据设置）→ main 窗口鉴权 → VaultService（epoch、闲置、串行提交）→ Vault（加密、校验、原子文件替换）。列表不返回密码；显示/复制分别显式请求。轮盘只导航，未扩大 capability 或 CSP。

格式 LIMEV001：48 字节头部作为 AAD，16 字节 salt、24 字节 nonce，Argon2id 65536 KiB / 3 次 / 并行度 1，32 字节密钥，XChaCha20-Poly1305。所有账号字段加密。限制 8 MiB / 2000 条。详见 [密码库](vault.md)。

创建/恢复先在线程池准备，随后持服务互斥锁检查 epoch，再提交磁盘并发布内存状态。改密和导入同样检查会话。锁定清除密钥、解密记录、导入票据并推进 epoch；迟到操作拒绝。每秒后台检查闲置；关闭主窗仅隐藏现有 WebView，恢复不重新挂载。退出、手动锁定和闲置到期终止会话；不接入系统锁屏通知。

剪贴板服务仅处理显式复制，30 秒或锁定/退出时核对所有权再清理，无法清除第三方历史。原子替换不能代替异地加密备份，主密码遗忘无法恢复。

未来填写模块没有接入产品。C0 见 [设计](quickfill-design.md)，旧 [可行性](feasibility.md) 和 [原型](quickfill-prototype.md) 仅作历史记录，不能当作当前功能或兼容性证明。
