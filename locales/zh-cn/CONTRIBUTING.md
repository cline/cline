# 贡献到 Cline

我们很高兴您有兴趣为 Cline 做出贡献。无论您是修复错误、添加功能还是改进我们的文档，每一份贡献都让 Cline 更加智能！为了保持我们的社区充满活力和欢迎，所有成员必须遵守我们的[行为准则](CODE_OF_CONDUCT.md)。

## 报告错误或问题

错误报告有助于让 Cline 对每个人都更好！在创建新问题之前，请先[搜索现有问题](https://github.com/cline/cline/issues)以避免重复。当您准备好报告错误时，请前往我们的[问题页面](https://github.com/cline/cline/issues/new/choose)，在那里您会找到一个模板来帮助您填写相关信息。

<blockquote class='warning-note'>
    🔐 <b>重要：</b>如果您发现安全漏洞，请使用<a href="https://github.com/cline/cline/security/advisories/new">Github 安全工具私下报告</a>。
</blockquote>

## 决定要做什么

寻找一个好的首次贡献？查看标记为["good first issue"](https://github.com/cline/cline/labels/good%20first%20issue)或["help wanted"](https://github.com/cline/cline/labels/help%20wanted)的问题。这些是专门为新贡献者策划的领域，我们非常欢迎您的帮助！

我们也欢迎对我们的[文档](https://github.com/cline/cline/tree/main/docs)做出贡献！无论是修正错别字、改进现有指南，还是创建新的教育内容 - 我们希望建立一个社区驱动的资源库，帮助每个人充分利用 Cline。您可以从深入研究 `/docs` 并寻找需要改进的地方开始。

如果您计划开发一个更大的功能，请先创建一个[功能请求](https://github.com/cline/cline/discussions/categories/feature-requests?discussions_q=is%3Aopen+category%3A%22Feature+Requests%22+sort%3Atop)，以便我们讨论它是否符合 Cline 的愿景。

## 开发设置

1. **VS Code 扩展**

    - 打开项目时，VS Code 会提示您安装推荐的扩展
    - 这些扩展是开发所必需的 - 请接受所有安装提示
    - 如果您忽略了提示，可以从扩展面板手动安装它们

2. **本地开发**
    - 运行 `npm run install:all` 安装依赖项
    - 运行 `npm run test` 本地运行测试
    - 提交 PR 之前，运行 `npm run format:fix` 格式化您的代码

## 编写和提交代码

任何人都可以为 Cline 贡献代码，但我们要求您遵循以下指南，以确保您的贡献能够顺利集成：

1. **保持 Pull Request 集中**

    - 将 PR 限制为单个功能或错误修复
    - 将较大的更改拆分为较小的相关 PR
    - 将更改分为逻辑提交，以便独立审查

2. **代码质量**

    - 运行 `npm run lint` 检查代码风格
    - 运行 `npm run format` 自动格式化代码
    - 所有 PR 必须通过 CI 检查，包括 lint 和格式化
    - 提交前解决所有 ESLint 警告或错误
    - 遵循 TypeScript 最佳实践并保持类型安全

3. **测试**

    - 为新功能添加测试
    - 运行 `npm test` 确保所有测试通过
    - 如果您的更改影响现有测试，请更新它们
    - 在适当的情况下包括单元测试和集成测试

4. **提交指南**

    - 编写清晰、描述性的提交消息
    - 使用常规提交格式（例如，“feat:”，“fix:”，“docs:”）
    - 在提交中引用相关问题，使用 #issue-number

5. **提交前**

    - 将您的分支重新基于最新的 main
    - 确保您的分支成功构建
    - 仔细检查所有测试是否通过
    - 检查您的更改是否有任何调试代码或控制台日志

6. **Pull Request 描述**
    - 清楚描述您的更改内容
    - 包括测试更改的步骤
    - 列出任何重大更改
    - 对于 UI 更改，添加截图

## 贡献协议

通过提交 pull request，您同意您的贡献将根据与项目相同的许可证（[Apache 2.0](LICENSE)）进行许可。

记住：为 Cline 做贡献不仅仅是编写代码 - 这是成为一个社区的一部分，共同塑造 AI 辅助开发的未来。让我们一起构建一些令人惊叹的东西！🚀
