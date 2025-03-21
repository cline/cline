# 为 Roo Code 做贡献

我们很高兴您有兴趣为 Roo Code 做贡献。无论您是修复错误、添加功能，还是改进我们的文档，每一个贡献都让 Roo Code 变得更智能！为了保持我们的社区充满活力和欢迎，所有成员必须遵守我们的[行为准则](CODE_OF_CONDUCT.md)。

## 加入我们的社区

我们强烈鼓励所有贡献者加入我们的 [Discord 社区](https://discord.gg/roocode)！成为我们 Discord 服务器的一部分可以帮助您：

- 获得关于您贡献的实时帮助和指导
- 与其他贡献者和核心团队成员建立联系
- 了解项目发展和优先事项的最新信息
- 参与塑造 Roo Code 未来的讨论
- 寻找与其他开发者的合作机会

## 报告错误或问题

错误报告有助于使 Roo Code 对每个人都更好！在创建新问题之前，请[搜索现有问题](https://github.com/RooVetGit/Roo-Code/issues)以避免重复。当您准备报告错误时，前往我们的[问题页面](https://github.com/RooVetGit/Roo-Code/issues/new/choose)，那里有模板可以帮助您填写相关信息。

<blockquote class='warning-note'>
     🔐 <b>重要提示：</b>如果您发现安全漏洞，请使用 <a href="https://github.com/RooVetGit/Roo-Code/security/advisories/new">Github 安全工具私下报告它</a>。
</blockquote>

## 决定做什么

寻找一个好的首次贡献？查看我们 [Roo Code Issues](https://github.com/orgs/RooVetGit/projects/1) Github 项目中"Issue [Unassigned]"部分的问题。这些是专门为新贡献者精心挑选的，也是我们希望得到一些帮助的领域！

我们也欢迎对我们的[文档](https://docs.roocode.com/)做贡献！无论是修复错别字、改进现有指南，还是创建新的教育内容 - 我们希望建立一个由社区驱动的资源库，帮助每个人充分利用 Roo Code。您可以点击任何页面上的"Edit this page"快速进入 Github 中编辑文件的正确位置，或者直接访问 https://github.com/RooVetGit/Roo-Code-Docs。

如果您计划处理更大的功能，请先创建一个[功能请求](https://github.com/RooVetGit/Roo-Code/discussions/categories/feature-requests?discussions_q=is%3Aopen+category%3A%22Feature+Requests%22+sort%3Atop)，以便我们讨论它是否符合 Roo Code 的愿景。您还可以查看下面的[项目路线图](#项目路线图)，看看您的想法是否符合我们的战略方向。

## 项目路线图

Roo Code 有一个明确的开发路线图，指导我们的优先事项和未来方向。了解我们的路线图可以帮助您：

- 使您的贡献与项目目标保持一致
- 确定您的专业知识最有价值的领域
- 理解某些设计决策背后的背景
- 为支持我们愿景的新功能找到灵感

我们当前的路线图专注于六个关键支柱：

### 提供商支持

我们的目标是尽可能支持更多的提供商：

- 更加多功能的 "OpenAI Compatible" 支持
- xAI, Microsoft Azure AI, Alibaba Cloud Qwen, IBM Watsonx, Together AI, DeepInfra, Fireworks AI, Cohere, Perplexity AI, FriendliAI, Replicate
- 增强对 Ollama 和 LM Studio 的支持

### 模型支持

我们希望 Roo 在尽可能多的模型上运行良好，包括本地模型：

- 通过自定义系统提示和工作流程支持本地模型
- 基准评估和测试案例

### 系统支持

我们希望 Roo 在每个人的计算机上都能良好运行：

- 跨平台终端集成
- 对 Mac、Windows 和 Linux 的强大一致支持

### 文档

我们希望为所有用户和贡献者提供全面、易于访问的文档：

- 扩展的用户指南和教程
- 清晰的 API 文档
- 更好的贡献者指导
- 多语言文档资源
- 交互式示例和代码示例

### 稳定性

我们希望显著减少错误数量并增加自动化测试：

- 调试日志开关
- 用于发送错误/支持请求的"机器/任务信息"复制按钮

### 国际化

我们希望 Roo 能说每个人的语言：

- 我们希望 Roo Code 说每个人的语言
- Queremos que Roo Code hable el idioma de todos
- हम चाहते हैं कि Roo Code हर किसी की भाषा बोले
- نريد أن يتحدث Roo Code لغة الجميع

我们特别欢迎推进我们路线图目标的贡献。如果您正在处理符合这些支柱的内容，请在您的 PR 描述中提及。

## 开发设置

1. **克隆**仓库：

```sh
git clone https://github.com/RooVetGit/Roo-Code.git
```

2. **安装依赖**：

```sh
npm run install:all
```

3. **启动 webview（Vite/React 应用，具有热模块替换）**：

```sh
npm run dev
```

4. **调试**：
   在 VSCode 中按 `F5`（或**运行** → **开始调试**）打开一个加载了 Roo Code 的新会话。

对 webview 的更改将立即显示。对核心扩展的更改将需要重新启动扩展主机。

或者，您可以构建一个 .vsix 文件并直接在 VSCode 中安装：

```sh
npm run build
```

`bin/` 目录中将出现一个 `.vsix` 文件，可以用以下命令安装：

```sh
code --install-extension bin/roo-cline-<version>.vsix
```

## 编写和提交代码

任何人都可以为 Roo Code 贡献代码，但我们要求您遵循这些指导方针，以确保您的贡献能够顺利集成：

1. **保持 Pull Requests 聚焦**

    - 将 PR 限制在单一功能或错误修复
    - 将较大的更改分割成更小的相关 PR
    - 将更改分解为可以独立审查的逻辑提交

2. **代码质量**

    - 所有 PR 必须通过包括 linting 和格式化的 CI 检查
    - 在提交之前解决任何 ESLint 警告或错误
    - 回应 Ellipsis（我们的自动代码审查工具）的所有反馈
    - 遵循 TypeScript 最佳实践并保持类型安全

3. **测试**

    - 为新功能添加测试
    - 运行 `npm test` 确保所有测试通过
    - 如果您的更改影响现有测试，请更新它们
    - 在适当的情况下包括单元测试和集成测试

4. **提交指南**

    - 编写清晰、描述性的提交消息
    - 在提交中使用 #issue-number 引用相关问题

5. **提交前**

    - 在最新的 main 分支上变基您的分支
    - 确保您的分支成功构建
    - 再次检查所有测试是否通过
    - 检查您的更改中是否有任何调试代码或控制台日志

6. **Pull Request 描述**
    - 清晰描述您的更改做了什么
    - 包括测试更改的步骤
    - 列出任何破坏性更改
    - 为 UI 更改添加截图

## 贡献协议

通过提交 pull request，您同意您的贡献将在与项目相同的许可下获得许可（[Apache 2.0](../LICENSE)）。
