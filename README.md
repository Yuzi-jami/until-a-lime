<p align="center">
  <img src="src/orange-mark.svg" width="88" alt="酸橙">
</p>

# 直到密码变成一颗酸橙

一个带橙子悬浮轮盘的 Windows 密码管理器。密码保存在本机，用一个主密码管理网站和应用账号。当前桌面版本为 1.2.0。

[下载](https://github.com/Yuzi-jami/until-a-lime/releases/latest) · [更新日志](CHANGELOG.md) · [浏览器扩展](docs/browser-extension.md) · [反馈问题](https://github.com/Yuzi-jami/until-a-lime/issues)

## 功能

- **橙子轮盘**：搜索账号、快速保存、生成密码；拖动移动，贴边自动收起。
- **连续粘贴**：选择账号后粘贴用户名，按 Tab，再粘贴密码。
- **浏览器扩展**：支持 Edge 和 Chrome，填写账号、确认保存新账号或更新密码，记住常用账号。
- **密码收藏室**：搜索、收藏、分类整理、密码统计、浏览器 CSV 导入和加密备份。
- 可调界面字号和侧栏宽度，并可编辑侧栏账户信息。
- 浅色与深色主题、托盘常驻、自定义闲置锁定。

## 开始使用

从 [Releases](https://github.com/Yuzi-jami/until-a-lime/releases/latest) 下载 Windows x64 安装包，首次打开收藏室时设置主密码。

日常使用可以直接从桌面橙子搜索账号。浏览器自动填写需要先在应用的“浏览器插件”页面准备扩展，再按提示加载。

[安装与使用](docs/install.md) · [导入浏览器密码](docs/browser-csv.md) · [保存与分类](docs/quick-save-and-categories.md)

## 本地开发

使用 Rust、Tauri 2、React 和 TypeScript。准备好 Node.js 24 和 Rust MSVC 环境后：

```powershell
npm ci
npm run tauri -- build
```

安装包位于 `target/release/bundle/nsis/`。开发运行和测试见 [贡献指南](CONTRIBUTING.md)。

[项目结构](docs/architecture.md) · [密码库设计](docs/vault.md) · [后续计划](docs/roadmap.md)

## 许可证

[MIT](LICENSE)
