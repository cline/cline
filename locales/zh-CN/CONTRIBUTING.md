[English](../../CONTRIBUTING.md) • [Català](../ca/CONTRIBUTING.md) • [Deutsch](../de/CONTRIBUTING.md) • [Español](../es/CONTRIBUTING.md) • [Français](../fr/CONTRIBUTING.md) • [हिंदी](../hi/CONTRIBUTING.md) • [Italiano](../it/CONTRIBUTING.md) • [Nederlands](../nl/CONTRIBUTING.md) • [Русский](../ru/CONTRIBUTING.md)

[日本語](../ja/CONTRIBUTING.md) • [한국어](../ko/CONTRIBUTING.md) • [Polski](../pl/CONTRIBUTING.md) • [Português (BR)](../pt-BR/CONTRIBUTING.md) • [Türkçe](../tr/CONTRIBUTING.md) • [Tiếng Việt](../vi/CONTRIBUTING.md) • <b>简体中文</b> • [繁體中文](../zh-TW/CONTRIBUTING.md)

# 参与 Roo Code 贡献

Roo Code 是一个由社区驱动的项目，我们高度重视每一份贡献。为了简化协作流程，我们采用 [Issue-First](#issue-first-方式) 原则，这意味着所有 [Pull Request (PR)](#提交-pull-request) 必须首先关联到 GitHub Issue。请仔细阅读本指南。

## 目录

- [贡献前须知](#贡献前须知)
- [寻找与规划你的贡献](#寻找与规划你的贡献)
- [开发与提交流程](#开发与提交流程)
- [法律声明](#法律声明)

## 贡献前须知

### 1. 行为准则

所有贡献者必须遵守我们的[行为准则](./CODE_OF_CONDUCT.md)。

### 2. 项目路线图

我们的路线图指引项目方向。请将你的贡献与这些关键目标保持一致：

### 可靠性优先

- 确保差异编辑和命令执行始终可靠
- 减少阻碍常规使用的摩擦点
- 确保在所有语言环境和平台上流畅运行
- 扩展对各种 AI 提供商和模型的强大支持

### 增强用户体验

- 简化用户界面，提高清晰度和直观性
- 持续改进工作流程，满足开发者对日常工具的高期望

### 引领代理性能

- 建立全面的评估基准（evals）衡量实际工作中的生产力
- 让每个人都能轻松运行和解读这些评估
- 提供明显提升评分的改进

在 PR 中请提及与这些领域的关联。

### 3. 加入 Roo Code 社区

- **主要方式：** 加入我们的 [Discord](https://discord.gg/roocode) 并私信 **Hannes Rudolph (`hrudolph`)**。
- **替代方式：** 有经验的贡献者可通过 [GitHub Projects](https://github.com/orgs/RooCodeInc/projects/1) 直接参与。

## 寻找与规划你的贡献

### 贡献类型

- **Bug 修复：** 解决代码问题。
- **新功能：** 添加新功能。
- **文档：** 完善指南和提高清晰度。

### Issue-First 方式

所有贡献必须从 GitHub Issue 开始。

- **检查现有 issue：** 搜索 [GitHub Issues](https://github.com/RooCodeInc/Roo-Code/issues)。
- **创建 issue：** 使用适当模板：
    - **Bug：** "Bug Report" 模板。
    - **功能：** "Detailed Feature Proposal" 模板。开始前需获得批准。
- **认领 issue：** 评论并等待正式分配。

**未关联已批准 issue 的 PR 可能会被关闭。**

### 决定要做什么

- 查看 [GitHub 项目](https://github.com/orgs/RooCodeInc/projects/1) 中未分配的 "Good First Issues"。
- 文档相关，请访问 [Roo Code Docs](https://github.com/RooCodeInc/Roo-Code-Docs)。

### 报告 Bug

- 先检查是否已有相关报告。
- 使用 ["Bug Report" 模板](https://github.com/RooCodeInc/Roo-Code/issues/new/choose) 创建新 bug 报告。
- **安全问题：** 通过 [security advisories](https://github.com/RooCodeInc/Roo-Code/security/advisories/new) 私下报告。

## 开发与提交流程

### 开发环境配置

1. **Fork & Clone：**

```
git clone https://github.com/你的用户名/Roo-Code.git
```

2. **安装依赖：**

```
npm run install:all
```

3. **调试：** 在 VS Code 中按 `F5` 打开。

### 编码规范

- 每个 PR 专注于一个功能或修复。
- 遵循 ESLint 和 TypeScript 最佳实践。
- 编写清晰的提交信息，引用相关 issue（如 `Fixes #123`）。
- 提供完整测试（`npm test`）。
- 提交前先在最新 `main` 分支上进行 rebase。

### 提交 Pull Request

- 如需早期反馈，可先提交**草稿 PR**。
- 清晰描述你的更改，遵循 Pull Request 模板。
- 为 UI 变更提供截图/视频。
- 说明是否需要更新文档。

### Pull Request 政策

- 必须引用已批准并分配的 issue。
- 不遵守政策的 PR 可能会被关闭。
- PR 应通过 CI 测试，符合路线图，并有清晰文档。

### 审查流程

- **每日筛查：** 维护者快速检查。
- **每周深入审查：** 全面评估。
- **根据反馈快速迭代**。

## 法律声明

提交贡献即表示你同意你的贡献将基于 Apache 2.0 许可证，与 Roo Code 的许可一致。
