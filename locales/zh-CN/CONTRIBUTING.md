[English](../../CONTRIBUTING.md) • [Català](../ca/CONTRIBUTING.md) • [Deutsch](../de/CONTRIBUTING.md) • [Español](../es/CONTRIBUTING.md) • [Français](../fr/CONTRIBUTING.md) • [हिंदी](../hi/CONTRIBUTING.md) • [Italiano](../it/CONTRIBUTING.md) • [Nederlands](../nl/CONTRIBUTING.md) • [Русский](../ru/CONTRIBUTING.md)

[日本語](../ja/CONTRIBUTING.md) • [한국어](../ko/CONTRIBUTING.md) • [Polski](../pl/CONTRIBUTING.md) • [Português (BR)](../pt-BR/CONTRIBUTING.md) • [Türkçe](../tr/CONTRIBUTING.md) • [Tiếng Việt](../vi/CONTRIBUTING.md) • <b>简体中文</b> • [繁體中文](../zh-TW/CONTRIBUTING.md)

# 参与 Roo Code 贡献

Roo Code 是一个由社区驱动的项目，我们非常重视每一位贡献者。为了让每个人的贡献流程顺畅高效，**我们采用“[Issue-First](#2-关键原则-issue-first-方式)”原则。** 这意味着所有工作都必须在提交 Pull Request _之前_ 关联到一个 GitHub Issue（详情见[PR 政策](#pull-request-pr-政策)）。请认真阅读本指南，了解如何参与贡献。
本指南介绍了如何为 Roo Code 做出贡献，无论是修复 bug、添加新功能还是完善文档。

## 目录

- [I. 贡献前须知](#i-贡献前须知)
    - [1. 行为准则](#1-行为准则)
    - [2. 了解项目路线图](#2-了解项目路线图)
        - [Provider 支持](#provider-支持)
        - [模型支持](#模型支持)
        - [系统支持](#系统支持)
        - [文档](#文档)
        - [稳定性](#稳定性)
        - [国际化](#国际化)
    - [3. 加入 Roo Code 社区](#3-加入-roo-code-社区)
- [II. 寻找与规划你的贡献](#ii-寻找与规划你的贡献)
    - [1. 贡献类型](#1-贡献类型)
    - [2. 关键原则：Issue-First 方式](#2-关键原则-issue-first-方式)
    - [3. 决定要做什么](#3-决定要做什么)
    - [4. 报告 bug 或问题](#4-报告-bug-或问题)
- [III. 开发与提交流程](#iii-开发与提交流程)
    - [1. 开发环境配置](#1-开发环境配置)
    - [2. 编码规范](#2-编码规范)
    - [3. 提交代码：Pull Request (PR) 流程](#3-提交代码-pull-request-pr-流程)
        - [草稿 Pull Request](#草稿-pull-request)
        - [Pull Request 描述](#pull-request-描述)
        - [Pull Request (PR) 政策](#pull-request-pr-政策)
            - [目标](#目标)
            - [Issue-First 方式](#issue-first-方式)
            - [开放 PR 条件](#开放-pr-条件)
            - [流程](#流程)
            - [责任分工](#责任分工)
- [IV. 法律声明](#iv-法律声明)
    - [贡献协议](#贡献协议)

## I. 贡献前须知

首先，请熟悉我们的社区标准和项目方向。

### 1. 行为准则

所有贡献者都必须遵守我们的[行为准则](https://github.com/RooVetGit/Roo-Code/blob/main/CODE_OF_CONDUCT.md)。请在贡献前仔细阅读。

### 2. 了解项目路线图

Roo Code 有清晰的发展路线图，指引我们的优先级和未来方向。了解路线图有助于你：

- 让你的贡献与项目目标保持一致
- 找到你最擅长的领域
- 理解某些设计决策的背景
- 获得新功能灵感，助力项目愿景

当前路线图聚焦六大核心：

#### Provider 支持

我们希望支持尽可能多的 Provider：

- 更强的“OpenAI 兼容”支持
- xAI、Microsoft Azure AI、Alibaba Cloud Qwen、IBM Watsonx、Together AI、DeepInfra、Fireworks AI、Cohere、Perplexity AI、FriendliAI、Replicate
- 增强 Ollama 和 LM Studio 支持

#### 模型支持

我们希望 Roo 能在尽可能多的模型（包括本地模型）上运行：

- 通过自定义系统提示词和工作流支持本地模型
- Benchmark 测试与用例

#### 系统支持

我们希望 Roo 能在所有电脑上流畅运行：

- 跨平台终端集成
- 强大且一致地支持 Mac、Windows、Linux

#### 文档

我们希望为所有用户和贡献者提供全面、易用的文档：

- 扩展用户指南和教程
- 清晰的 API 文档
- 更好的贡献者指引
- 多语言文档资源
- 交互式示例和代码片段

#### 稳定性

我们希望大幅减少 bug 数量并提升自动化测试覆盖：

- 调试日志开关
- “机器/任务信息”一键复制按钮，便于 bug/支持请求

#### 国际化

我们希望 Roo Code 说每个人的语言：

- 我们希望 Roo Code 说每个人的语言
- Queremos que Roo Code hable el idioma de todos
- हम चाहते हैं कि Roo Code हर किसी की भाषा बोले
- نريد أن يتحدث Roo Code لغة الجميع

特别欢迎推进路线图目标的贡献。如果你的工作与这些方向相关，请在 PR 描述中说明。

### 3. 加入 Roo Code 社区

加入 Roo Code 社区是一个很好的起点：

- **主要方式**：
    1.  加入 [Roo Code Discord 社区](https://discord.gg/roocode)。
    2.  加入后，私信 **Hannes Rudolph**（Discord: `hrudolph`），表达你的兴趣并获取指导。
- **有经验的贡献者可选**：如果你熟悉 Issue-First 方式，可以直接通过 GitHub 跟进 [看板](https://github.com/orgs/RooVetGit/projects/1)，通过 issue 和 pull request 沟通。

## II. 寻找与规划你的贡献

明确你想做什么以及如何开展。

### 1. 贡献类型

我们欢迎多种形式的贡献：

- **Bug 修复**：修正现有代码中的问题
- **新功能**：添加新功能
- **文档**：完善指南、补充示例或修正错别字

### 2. 关键原则：Issue-First 方式

**所有贡献都必须从 GitHub Issue 开始。** 这是确保协作一致、避免无效劳动的关键步骤。

- **查找或创建 Issue**：
    - 开始前，先在 [GitHub Issues](https://github.com/RooVetGit/Roo-Code/issues) 检查是否已有相关 issue。
    - 如果有且未分配，评论表达你想认领，维护者会分配给你。
    - 如果没有，请在 [issues 页面](https://github.com/RooVetGit/Roo-Code/issues/new/choose) 用合适模板新建：
        - Bug 用“Bug Report”模板
        - 新功能用“Detailed Feature Proposal”模板。开始实现前请等待维护者（尤其是 @hannesrudolph）批准。
        - **注意**：功能的初步想法或讨论可在 [GitHub Discussions](https://github.com/RooVetGit/Roo-Code/discussions/categories/feature-requests) 开始，具体后再建“Detailed Feature Proposal” issue。
- **认领与分配**：
    - 明确评论表达你要做某个 issue。
    - 等待维护者在 GitHub 正式分配，避免多人重复劳动。
- **不遵守的后果**：
    - 未关联、未批准、未分配的 PR 可能会被关闭，不做完整 review。此政策确保贡献与项目优先级一致，尊重所有人的时间。

这样有助于我们跟踪工作、确保变更是需要的，并高效协作。

### 3. 决定要做什么

- **Good First Issues**：查看 GitHub [Roo Code Issues 项目](https://github.com/orgs/RooVetGit/projects/1) 的“未分配 Issue”部分。
- **文档**：虽然本 `CONTRIBUTING.md` 是代码贡献主指南，但如想参与其他文档（如用户指南、API 文档），请查阅 [Roo Code Docs 仓库](https://github.com/RooVetGit/Roo-Code-Docs) 或在 Discord 社区咨询。
- **提出新功能**：
    1.  **初步想法/讨论**：广泛或初步想法可在 [GitHub Discussions](https://github.com/RooVetGit/Roo-Code/discussions/categories/feature-requests) 讨论。
    2.  **正式提案**：具体、可执行的建议请用 [issues 页面](https://github.com/RooVetGit/Roo-Code/issues/new/choose) 的“Detailed Feature Proposal”模板新建 issue。这是 **Issue-First 方式** 的关键环节。

### 4. 报告 bug 或问题

如果你发现 bug：

1.  **查找已有 issue**：在 [GitHub Issues](https://github.com/RooVetGit/Roo-Code/issues) 检查是否已有人报告。
2.  **新建 issue**：如无重复，请用 [issues 页面](https://github.com/RooVetGit/Roo-Code/issues/new/choose) 的“Bug Report”模板新建。

> 🔐 **安全漏洞**：如发现安全漏洞，请通过 [GitHub Security Advisory Tool](https://github.com/RooVetGit/Roo-Code/security/advisories/new) 私下报告。请勿公开 issue。

## III. 开发与提交流程

按以下步骤进行开发和提交。

### 1. 开发环境配置

1.  **Fork & Clone**：
    - 在 GitHub 上 fork 本仓库
    - 本地克隆你的 fork：`git clone https://github.com/你的用户名/Roo-Code.git`
2.  **安装依赖**：`npm run install:all`
3.  **运行 Webview（开发模式）**：`npm run dev`（适用于 Vite/React 应用，支持 HMR）
4.  **调试扩展**：在 VS Code 按 `F5`（或 **Run** → **Start Debugging**），打开 Roo Code 的 Extension Development Host 窗口

webview（`webview-ui`）的更改会通过热更新（HMR）即时生效。核心扩展（`src`）的更改需重启 Extension Development Host。

也可以构建并安装 `.vsix` 包：

```sh
npm run build
code --install-extension bin/roo-cline-<版本号>.vsix
```

（将 `<版本号>` 替换为实际生成的文件版本号）

### 2. 编码规范

- **聚焦 PR**：每个 PR 只做一项功能/修复
- **代码质量**：
    - 通过 CI 检查（lint、格式化）
    - 修复 ESLint 警告或错误（`npm run lint`）
    - 响应自动代码审查工具反馈
    - 遵循 TypeScript 最佳实践，保持类型安全
- **测试**：
    - 新功能需添加测试
    - 运行 `npm test`，确保所有测试通过
    - 如有影响，需更新现有测试
- **提交信息**：
    - 编写清晰、描述性的提交信息
    - 用 `#issue-number`（如 `Fixes #123`）引用相关 issue
- **PR 提交前检查**：
    - 将分支 rebase 到最新 upstream `main`
    - 确保代码可构建（`npm run build`）
    - 所有测试通过（`npm test`）
    - 移除调试代码或 `console.log`

### 3. 提交代码：Pull Request (PR) 流程

#### 草稿 Pull Request

对于尚未准备好完整 review 的工作，请用草稿 PR：

- 运行自动检查（CI）
- 提前获取维护者或其他贡献者反馈
- 标明工作正在进行中

只有当所有检查通过，并且你认为已满足“编码规范”和“Pull Request 描述”要求时，才将 PR 标记为“Ready for Review”。

#### Pull Request 描述

你的 PR 描述必须完整，并遵循我们的 [Pull Request 模板](.github/pull_request_template.md) 结构。要点包括：

- 关联的已批准 GitHub Issue 链接
- 变更内容及目的的清晰描述
- 测试变更的详细步骤
- 所有 breaking changes 列表
- **UI 变更需提供前后截图或视频**
- **如需更新用户文档，请说明涉及哪些文档/部分**

#### Pull Request (PR) 政策

##### 目标

保持清晰、聚焦、可管理的 PR backlog。

##### Issue-First 方式

- **必须**：开始前，需有已批准并分配的 GitHub Issue（“Bug Report”或“Detailed Feature Proposal”）
- **审批**：尤其是重大变更，需维护者（特别是 @hannesrudolph）提前审批
- **引用**：PR 描述中需明确引用这些已审批的 issue
- **后果**：不遵守流程的 PR 可能会被关闭，不做完整 review

##### 开放 PR 条件

- **可合并**：通过所有 CI 测试，符合路线图（如适用），关联已批准并分配的 issue，有清晰文档/注释，UI 变更有前后图片/视频
- **需关闭**：CI 测试失败、严重合并冲突、不符项目目标或长期（>30 天）无更新

##### 流程

1.  **Issue 资格审核与分配**：@hannesrudolph（或其他维护者）审核并分配新/现有 issue
2.  **初步 PR 筛查（每日）**：维护者快速检查新 PR，筛选紧急或关键问题
3.  **详细 PR 审查（每周）**：维护者详细评估 PR 的准备度、与 issue 的一致性和整体质量
4.  **详细反馈与迭代**：根据审查反馈（Approve、Request Changes、Reject），贡献者需及时响应和改进
5.  **决策阶段**：通过的 PR 合并，无法解决或不符方向的 PR 说明原因后关闭
6.  **后续跟进**：被关闭 PR 的作者可根据反馈修正后重新提交

##### 责任分工

- **Issue 资格审核与流程把控（@hannesrudolph & 维护者）**：确保所有贡献遵循 Issue-First 方式，指导贡献者
- **维护者（开发团队）**：初步/详细审查 PR，提供技术反馈，决定批准/拒绝，合并 PR
- **贡献者**：确保 PR 关联已批准并分配的 issue，遵守质量规范，及时响应反馈

本政策确保流程清晰、高效集成。

## IV. 法律声明

### 贡献协议

提交 Pull Request 即表示你同意你的贡献将以 [Apache 2.0 许可证](LICENSE)（或当前项目许可证）授权，与项目一致。
