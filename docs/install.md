# Windows 安装构建

选择 NSIS 单一目标，currentUser 安装，无需默认提权；identifier 保持 dev.untilalime.desktop，版本 0.1.0。npm.cmd run tauri -- build 生成 target/release/bundle/nsis 下安装包。图标使用仓库 icons/icon.ico；素材权利核验仍待完成。

WebView2 配置 downloadBootstrapper：缺少运行时时需联网下载微软引导程序。离线机器需预装 WebView2。安装包未配置签名，可能出现 SmartScreen 提示，不是公开发布版本。

在单独 Windows 测试用户/虚拟机检查安装→启动→创建虚构库→同版本覆盖安装→重开核对→卸载。默认不要删除 AppData 密码库；本项目不添加删除用户库的卸载钩子。实际保留行为需安装测试证明，不能仅从配置认定通过。不要卸载日常实例。
