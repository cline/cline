# 为 Cline 做贡献

我们很高兴您有兴趣为 Cline 做出贡献。无论您是在修复错误、添加功能还是改进我们的文档，每一次贡献都会让 Cline 更智能！为了保持我们的社区充满活力和热情，所有成员都必须遵守我们的 [行为准则]（CODE_OF_CONDUCT.md）。

## 报告 Bug 或问题

错误报告有助于让 Cline 对每个人都更好！在创建新 Issue 之前，请 [搜索现有 Issue]（https://github.com/cline/cline/issues） 以避免重复。当您准备好报告错误时，请前往我们的 [问题页面]（https://github.com/cline/cline/issues/new/choose），在那里您可以找到一个模板来帮助您填写相关信息。

<blockquote class='warning-note'>
     🔐 <b>重要提示：</b>如果您发现安全漏洞，请使用 <a href=“https://github.com/cline/cline/security/advisories/new”>Github 安全工具私下报告</a>。
</blockquote>

## 决定要做什么
正在寻找一个好的第一个贡献？查看标记为 [“good first issue”]（https://github.com/cline/cline/labels/good%20first%20issue） 或 [“help wanted”]（https://github.com/cline/cline/labels/help%20wanted） 的期刊。这些是专门为新贡献者和我们希望提供帮助的领域策划的！

我们也欢迎为我们的 [文档]（https://github.com/cline/cline/tree/main/docs） 做出贡献！无论是修复拼写错误、改进现有指南还是创建新的教育内容 - 我们都希望建立一个社区驱动的资源存储库，帮助每个人充分利用 Cline。你可以从深入研究 '/docs' 开始，寻找需要改进的领域。

如果您打算开发更大的功能，请先创建一个 [功能请求]（https://github.com/cline/cline/discussions/categories/feature-requests?discussions_q=is%3Aopen+category%3A%22Feature+Requests%22+sort%3Atop），以便我们讨论它是否与 Cline 的愿景一致。
## 开发设置

1. **VS Code 扩展**

- 打开项目时，VS Code 会提示你安装推荐的扩展
    - 这些扩展是开发所必需的 - 请接受所有安装提示
    - 如果您关闭了提示，则可以从“扩展”面板手动安装它们

2. **本地开发**
    - 运行 npm run install:all' 以安装依赖项
    - 运行 'npm run test' 在本地运行测试
    - 在提交 PR 之前，请运行 npm run format：fix' 来格式化你的代码

## 编写和提交代码

任何人都可以向 Cline 贡献代码，但我们要求您遵循以下准则，以确保您的贡献可以顺利集成：

1. **保持拉取请求的重点**

- 将 PR 限制为单个功能或 bug 修复
    - 将较大的更改拆分为较小的相关 PR
    - 将更改分解为可独立审查的逻辑提交

2. **代码质量**

- 运行 npm run lint 检查代码样式
- 运行 npm run format 自动格式化代码
    - 所有 PR 都必须通过 CI 检查，包括 linting 和格式化
    - 在提交之前解决任何 ESLint 警告或错误
    - 遵循 TypeScript 最佳实践并维护类型安全

3. **测试**

- 为新功能添加测试
    - 运行“npm test”以确保所有测试都通过
    - 如果您的更改影响到现有测试，请更新这些测试
    - 在适当的情况下包括单元测试和集成测试

4. **提交准则**

- 编写清晰的描述性提交消息
    - 使用传统的提交格式（例如，“feat：”、“fix：”、“docs：”）
    - 使用 #issue 号在提交中引用相关问题

5. **提交之前**

- 在最新的 main 上变基你的分支
    - 确保您的分支成功构建
    - 仔细检查所有测试是否通过
    - 查看您的更改是否有任何调试代码或控制台日志

6. **拉取请求描述**
- 清楚地描述您的更改的作用
    - 包括测试更改的步骤
    - 列出任何重大更改
    - 为 UI 更改添加屏幕截图

## 贡献协议

提交拉取请求，即表示您同意您的贡献将获得与项目相同的许可证 （[Apache 2.0]（LICENSE））。

请记住：为 Cline 做贡献不仅仅是编写代码，而是成为塑造 AI 辅助开发未来的社区的一部分。让我们一起创造令人惊叹的东西吧！🚀