# RecallPress 使用指南

## 一次性安装 Chrome 扩展

1. 访问 `chrome://extensions/`。
2. 开启“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择克隆目录下的 `browser-extension` 文件夹。
5. 回到 ChatGPT 页面并刷新。

## 每次复习前

在项目目录运行：

```bash
pnpm dev:sync
```

这个命令会同时启动：

- VuePress：`http://localhost:8080/`
- ChatGPT 同步服务：`http://127.0.0.1:3847/`

## 同步对话

完成 ChatGPT 问答后，点击页面右下角的“收进复习库”。生成的 Markdown 文件位于：

```text
src/interview/chatgpt/
```

扩展会把一个会话拆成“一个问题一页”，并按会话建立目录。同一个 ChatGPT 对话再次同步时会更新原问题页，并为后续新问题增加页面。设置面板中可以开启“回答完成后自动同步”。

## 常见问题

### 页面没有同步按钮

确认扩展已启用，然后刷新 ChatGPT 页面。扩展更新后也需要刷新页面。

### 显示“服务未启动”

确认项目终端中正在运行 `pnpm dev:sync`。也可以访问 `http://127.0.0.1:3847/health` 检查服务。

### VuePress 没有立即出现新文章

开发服务器通常会自动刷新。如果侧边栏未更新，重启 `pnpm dev:sync`；生产发布前运行 `pnpm docs:build`。

### 可以公开发布吗

可以，但生成的笔记会进入静态网站。发布前务必检查个人信息、公司资料、密钥和其他隐私内容。
