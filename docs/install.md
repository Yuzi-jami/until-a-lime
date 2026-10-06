# Windows 安装构建

GitHub 首发版本为 [v1.0.0](https://github.com/Yuzi-jami/until-a-lime/releases/tag/v1.0.0)。下载 `Until-a-lime_1.0.0_x64-setup.exe`，双击安装；同页 `SHA256SUMS.txt` 提供校验值，可用 `Get-FileHash -Algorithm SHA256` 核对。安装后进入收藏室设置主密码；浏览器扩展按 [扩展说明](browser-extension.md) 准备并确认加载。

选择 NSIS 单一目标，currentUser 安装，无需默认提权；identifier 保持 dev.untilalime.desktop，版本 1.0.0。npm.cmd run tauri -- build 生成 target/release/bundle/nsis 下安装包。图标使用仓库 icons/icon.ico；素材权利核验仍待完成。1.0 沿用原 AppData 路径，不创建新库或搬迁旧库。Debug 和 Release 使用同一密码库与单实例标识，先从托盘退出旧进程再启动新版。

WebView2 配置 downloadBootstrapper：缺少运行时时需联网下载微软引导程序。离线机器需预装 WebView2。安装包未配置签名，可能出现 SmartScreen 提示。首发沿用仓库现有可见性，未完成独立安全审计。

在单独 Windows 测试用户/虚拟机检查安装→启动→创建虚构库→同版本覆盖安装→重开核对→卸载。默认不要删除 AppData 密码库；本项目不添加删除用户库的卸载钩子。实际保留行为需安装测试证明，不能仅从配置认定通过。不要卸载日常实例。
