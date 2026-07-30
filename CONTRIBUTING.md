# 参与贡献

感谢你帮助改进 RecallPress。

## 开发流程

1. Fork 仓库并从 `main` 创建功能分支。
2. 安装 Node.js 22 与 pnpm 10。
3. 运行 `pnpm install --frozen-lockfile`。
4. 修改后运行：

```bash
pnpm test:sync
pnpm docs:build
```

5. 提交范围清晰的 Pull Request，说明动机、实现方式和验证结果。界面改动请附截图或录屏。

## 提交内容

- 不要提交真实 API Key、`.env.local`、`.chatgpt-sync/` 或个人同步文章。
- 测试中只能使用明显无效的示例密钥。
- 尽量让新增逻辑可在 macOS、Windows 和 Linux 上运行。
- 用户可见行为变化请更新 README 和 CHANGELOG。

## 报告问题

普通缺陷可以使用 Issue 模板。安全问题请阅读 [SECURITY.md](./SECURITY.md)，不要公开漏洞或凭据。
