# 当前架构

2026-10-23，源码桌面 1.1.0 / 扩展 0.3.0，本地构建未发布。Rust + Tauri 2 + React + TypeScript。网页预览只用内存虚构数据；桌面 WebView 经 IPC 使用本地库。

主窗口 React（VaultRoot / App / 数据设置 / 分类面板）→ main 命令鉴权 → VaultService（epoch、闲置、串行提交）→ Vault（加密、校验、原子文件替换）。列表只返回元数据；显示 / 复制已有密码分别显式请求。

悬浮窗口 Floating / QuickSave 使用专用命令搜索元数据、复制所选账号、读取保存上下文和保存。保存请求绑定会话 epoch，更新重复账号时只替换密码，沿用后端当前元数据；成功后广播元数据变化。已有密码不批量交付给悬浮前端，管理和揭示命令仍限制 main。

浏览器链路为 HTTPS 输入框建议 / 工具栏 → MV3 后台 → Native Messaging host → 127.0.0.1 桥接 → VaultService。扩展建议仅请求元数据，用户选择后才交付所选凭据；扩展后台检查目标 documentId，Rust 桥接检查会话、扩展来源和同站域名。固定 ID 和当前用户目录 token 不能防御已控制本机用户的恶意进程。

capture.js 在用户提交 / 手动保存时读取当前表单，后台验证发送者及来源后发送 capture；Rust 生成随机短期票据，密码仅留内存，浏览器 storage.session 只缓存提示元数据。save 必须提交同源票据并明确目标账号；更新再次检查原记录及密码是否变化。成功后广播 lime-vault-changed。排序使用实际文档主机与路径；remember 将所选账号偏好写入加密 browser_preferences，去掉 query / fragment。

格式 LIMEV001：48 字节头部作为 AAD，16 字节 salt、24 字节 nonce，Argon2id 65536 KiB / 3 次 / 并行度 1，32 字节密钥，XChaCha20-Poly1305。所有账号字段加密。限制 8 MiB / 2000 条。详见 [密码库](vault.md)。

创建/恢复先在线程池准备，随后持服务互斥锁检查 epoch，再提交磁盘并发布内存状态。改密和导入同样检查会话。锁定清除密钥、解密记录、导入票据并推进 epoch；迟到操作拒绝。每秒后台检查闲置；关闭主窗仅隐藏现有 WebView，恢复不重新挂载。退出、手动锁定和闲置到期终止会话；不接入系统锁屏通知。

剪贴板服务仅处理显式复制，30 秒或锁定/退出时核对所有权再清理，无法清除第三方历史。原子替换不能代替异地加密备份，主密码遗忘无法恢复。

普通应用填写由 quick_paste 在显式选择账号后复制用户名，并在最长 20 秒的窗口内用 GetAsyncKeyState 一次性等待 Tab，再经会话检查复制所选密码。用户自行粘贴；没有 SendInput / UIA 或自动提交。Esc、锁定、超时和显式取消终止等待，无用户名记录直接复制密码。

分类规则以 category_rules 可选字段保存在加密数据内。读旧库默认为空，不自动改分组；分组预览携带原分类并整批提交，写盘失败或并发变化拒绝整批。

浮窗尺寸与贴边动画由 floating_layout 管理，位置持久化由 placement 管理。主程序和 host 随 NSIS 分发，扩展文件嵌入程序，在用户准备 / 已启用连接恢复时部署到当前用户目录；不静默安装浏览器扩展。

旧 [填写设计](quickfill-design.md)、[可行性](feasibility.md) 和 [原型](quickfill-prototype.md) 仅作历史记录，不能作为当前实现或兼容性证明。
