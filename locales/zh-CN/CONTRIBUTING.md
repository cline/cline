<div align="center">
<sub>

[English](../../CONTRIBUTING.md) • [Català](../ca/CONTRIBUTING.md) • [Deutsch](../de/CONTRIBUTING.md) • [Español](../es/CONTRIBUTING.md) • [Français](../fr/CONTRIBUTING.md) • [हिंदी](../hi/CONTRIBUTING.md) • [Bahasa Indonesia](../id/CONTRIBUTING.md) • [Italiano](../it/CONTRIBUTING.md) • [日本語](../ja/CONTRIBUTING.md)

</sub>
<sub>

[한국어](../ko/CONTRIBUTING.md) • [Nederlands](../nl/CONTRIBUTING.md) • [Polski](../pl/CONTRIBUTING.md) • [Português (BR)](../pt-BR/CONTRIBUTING.md) • [Русский](../ru/CONTRIBUTING.md) • [Türkçe](../tr/CONTRIBUTING.md) • [Tiếng Việt](../vi/CONTRIBUTING.md) • <b>简体中文</b> • [繁體中文](../zh-TW/CONTRIBUTING.md)

</sub>
</div>

# 为 Roo Code 做贡献

Roo Code 是一个由社区驱动的项目，我们非常重视每一份贡献。为了简化协作，我们采用 [“问题优先” 的方法](#问题优先方法)，这意味着所有的 [拉取请求 (PR)](#提交拉取请求) 都必须首先链接到一个 GitHub 问题。请仔细阅读本指南。

## 目录

- [在您贡献之前](#在您贡献之前)
- [寻找和规划您的贡献](#寻找和规划您的贡献)
- [开发和提交流程](#开发和提交流程)
- [法律](#法律)

## 在您贡献之前

### 1. 行为准则

所有贡献者都必须遵守我们的 [行为准则](./CODE_OF_CONDUCT.md)。

### 2. 项目路线图

我们的路线图指导着项目的方向。请将您的贡献与这些关键目标保持一致：

### 可靠性第一

- 确保差异编辑和命令执行始终可靠。
- 减少阻碍常规使用的摩擦点。
- 保证在所有地区和平台上的流畅操作。
- 扩大对各种人工智能提供商和模型的强大支持。

### 增强的用户体验

- 简化用户界面/用户体验，以提高清晰度和直观性。
- 不断改进工作流程，以满足开发人员对日常使用工具的高期望。

### 在代理性能上领先

- 建立全面的评估基准 (evals) 来衡量真实世界的生产力。
- 让每个人都能轻松运行和解释这些评估。
- 发布能显示评估分数明显提高的改进。

在您的 PR 中提及与这些领域的一致性。

### 3. 加入 Roo Code 社区

- **主要方式：** 加入我们的 [Discord](https://discord.gg/roocode) 并私信 **Hannes Rudolph (`hrudolph`)**。
- **替代方式：** 经验丰富的贡献者可以通过 [GitHub 项目](https://github.com/orgs/RooCodeInc/projects/1) 直接参与。

## 寻找和规划您的贡献

### 贡献类型

- **错误修复：** 解决代码问题。
- **新功能：** 添加功能。
- **文档：** 改进指南和清晰度。

### 问题优先方法

所有贡献都始于使用我们精简模板的 GitHub 问题。

- **检查现有问题**：在 [GitHub 问题](https://github.com/RooCodeInc/Roo-Code/issues) 中搜索。
- **使用以下模板创建问题**：
    - **增强功能：** “增强请求”模板（侧重于用户利益的简单语言）。
    - **错误：** “错误报告”模板（最少的复现步骤 + 预期与实际 + 版本）。
- **想参与其中吗？** 在问题上评论“领取”，并在[Discord](https://discord.gg/roocode)上私信 **Hannes Rudolph (`hrudolph`)** 以获得分配。分配将在帖子中确认。
- **PR 必须链接到问题。** 未链接的 PR 可能会被关闭。

### 决定做什么

- 查看 [GitHub 项目](https://github.com/orgs/RooCodeInc/projects/1) 中的“问题 [未分配]”问题。
- 如需文档，请访问 [Roo Code 文档](https://github.com/RooCodeInc/Roo-Code-Docs)。

### 报告错误

- 首先检查现有的报告。
- 使用 [“错误报告”模板](https://github.com/RooCodeInc/Roo-Code/issues/new/choose) 创建一个新错误，并提供：
    - 清晰、编号的复现步骤
    - 预期与实际结果
    - Roo Code 版本（必需）；如果相关，还需提供 API 提供商/模型
- **安全问题**：通过 [安全公告](https://github.com/RooCodeInc/Roo-Code/security/advisories/new) 私下报告。

## 开发和提交流程

### 开发设置

1. **复刻和克隆：**

```
git clone https://github.com/您的用户名/Roo-Code.git
```

2. **安装依赖项：**

```
pnpm install
```

3. **调试：** 使用 VS Code 打开（`F5`）。

### 编码指南

- 每个功能或修复一个集中的 PR。
- 遵循 ESLint 和 TypeScript 的最佳实践。
- 编写清晰、描述性的提交，并引用问题（例如，`修复 #123`）。
- 提供全面的测试（`npm test`）。
- 在提交前变基到最新的 `main` 分支。

### 提交拉取请求

- 如果希望获得早期反馈，请以 **草稿 PR** 开始。
- 遵循拉取请求模板，清晰地描述您的更改。
- 在 PR 描述/标题中链接问题（例如，“修复 #123”）。
- 为用户界面更改提供屏幕截图/视频。
- 指明是否需要更新文档。

### 拉取请求政策

- 必须引用一个已分配的 GitHub 问题。要获得分配：在问题上评论“领取”，并在[Discord](https://discord.gg/roocode)上私信 **Hannes Rudolph (`hrudolph`)**。分配将在帖子中确认。
- 未链接的 PR 可能会被关闭。
- PR 必须通过 CI 测试，与路线图保持一致，并有清晰的文档。

### 审查流程

- **每日分类：** 维护人员进行快速检查。
- **每周深入审查：** 全面评估。
- **根据反馈及时迭代**。

## 法律

通过贡献，您同意您的贡献将根据 Apache 2.0 许可证进行许可，这与 Roo Code 的许可一致。
