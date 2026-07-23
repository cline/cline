<p align="center">
  <img src="assets/icons/icon.png" width="80" alt="Cline" />
</p>

<h1 align="center">Cline</h1>

<p align="center">
你 IDE 和终端中的开源编程助手。
</p>

<div align="center">

<div align="center">
<table>
<tbody>
<td align="center">
<a href="https://docs.cline.bot" target="_blank"><strong>文档</strong></a>
</td>
<td align="center">
<a href="https://discord.gg/cline" target="_blank"><strong>Discord</strong></a>
</td>
<td align="center">
<a href="https://www.reddit.com/r/cline/" target="_blank"><strong>r/cline</strong></a>
</td>
<td align="center">
<a href="https://github.com/cline/cline/discussions/categories/feature-requests?discussions_q=is%3Aopen+category%3A%22Feature+Requests%22+sort%3Atop" target="_blank"><strong>功能建议</strong></a>
</td>
<td align="center">
<a href="https://cline.bot/join-us" target="_blank"><strong>加入我们！</strong></a>
</td>
</tbody>
</table>
</div>

</div>

<br>

<div align="center">
<table>
<tr>
<td align="center" width="50%">

### 命令行工具 (CLI)

在终端中运行 Cline。
支持交互式对话或完全无头模式，
适用于 CI/CD 和脚本自动化。

```
npm i -g cline
```

<a href="./apps/cli/README.md">了解更多</a>
<br><br>

</td>
<td align="center" width="50%">

### 看板 (Kanban)

基于网页的多智能体任务看板。
每个卡片都有独立的工作目录、自动提交和依赖链。

```
npm i -g kanban
```

<a href="https://github.com/cline/kanban">了解更多</a>
<br><br>

</td>
</tr>
<tr>
<td align="center" width="50%">

### VS Code 扩展

你编辑器中的 AI 编程助手。
创建文件、运行命令、浏览网页，
并在人类确认下使用各种工具。

<a href="https://marketplace.visualstudio.com/items?itemName=saoudrizwan.claude-dev">从 VS 应用市场安装</a>
<br><br>

</td>
<td align="center" width="50%">

### JetBrains 插件

在 IntelliJ IDEA、PyCharm、WebStorm、GoLand 
等 JetBrains 全家桶中获得相同的 Cline 体验。

<a href="https://plugins.jetbrains.com/plugin/28247-cline">从 JetBrains 应用市场安装</a>
<br><br>

</td>
</tr>
</table>
</div>

<div align="center">
<table>
<tr>
<td align="center">

### SDK

使用与 CLI、看板、VS Code 扩展和 JetBrains 插件
相同的引擎，构建你自己的 AI 智能体和集成。
支持自定义工具、多智能体团队、连接器、
定时自动化等。

```
npm install @cline/sdk
```

<a href="https://docs.cline.bot/cline-sdk/overview">文档</a>
<br><br>

</td>
</tr>
</table>
</div>

---

## 目录

| 产品 | 说明 | 位置 | 更新日志 |
|---------|------------|--------------|--------------|
| **SDK** | Node.js 程序化智能体 API 和扩展导出。 | [`sdk/`](https://github.com/cline/cline/tree/main/sdk) | [CHANGELOG.md](https://github.com/cline/cline/blob/main/sdk/CHANGELOG.md) |
| **CLI** | 终端界面、无头模式、Shell 命令和 CLI 专属流程。 | [`apps/cli/`](https://github.com/cline/cline/tree/main/apps/cli) | [CHANGELOG.md](https://github.com/cline/cline/blob/main/apps/cli/CHANGELOG.md) |
| **VS Code 扩展** | 应用市场扩展和扩展宿主集成。 | [`/`](https://github.com/cline/cline/tree/main) (正在迁移中) | [CHANGELOG.md](https://github.com/cline/cline/blob/main/CHANGELOG.md) |
| **JetBrains 插件** | JetBrains 托管的客户端，与共享的智能体核心通信。 | 目前暂未开源 JetBrains 插件 | - |
| **看板 (Kanban)** | 基于网页的多智能体任务看板。 | [`cline/kanban`](https://github.com/cline/kanban) | [CHANGELOG.md](https://github.com/cline/kanban/blob/main/CHANGELOG.md) |
| **文档站点** | 公开文档页面。 | [`docs/`](https://docs.cline.bot/) | - |

## 跨项目编辑代码

Cline 会读取你的项目结构，理解文件之间的关系，并在整个代码库中进行协调修改。它在工作过程中会实时监控代码检查器和编译器的错误，在你看到之前就能修复缺少导入、类型不匹配和语法错误等问题。在 VS Code 和 JetBrains 中，每次编辑都会以 diff 的形式呈现，你可以审查、修改或撤销。所有更改都带有检查点记录，因此你可以轻松撤销智能体的工作。

## 运行 Bash 命令

Cline 直接在终端中执行命令并实时监控输出。安装包、运行构建脚本、执行测试、部署应用、管理数据库。对于像开发服务器这样的长期运行进程，Cline 会在后台继续工作，并对新出现的输出做出反应，实时捕捉编译错误、测试失败和服务器崩溃。

## 计划与执行

在计划模式和执行模式之间切换。在计划模式下，Cline 会探索你的代码库、提出澄清问题并制定策略。一旦你们达成一致，切换到执行模式，Cline 就会执行计划。每个文件编辑和终端命令都需要你的批准，因此你可以完全掌控实际发生的变化。或者开启自动批准，让 Cline 自主运行。

## 规则与技能

在 `.clinerules` 文件中定义项目特定的规则，指导 Cline 如何在你的代码库中工作：编码标准、架构约定、部署流程、测试要求。CLI、VS Code 扩展和 JetBrains 插件会自动识别这些规则。使用技能让模型在需要时加载特定规则。

## 兼容所有模型

Cline 不锁定于单一 AI 提供商。使用适合你工作流的任何模型：

| 提供商 | 模型 |
|----------|--------|
| Anthropic | Claude Opus, Sonnet, Haiku |
| OpenAI | GPT 系列模型 |
| Google | Gemini 系列模型 |
| OpenRouter | 来自任何提供商的 200+ 模型 |
| Vercel AI Gateway | 通过一个网关路由到多个提供商 |
| AWS Bedrock | Claude、Llama 等 |
| Azure / GCP Vertex | 所有托管模型 |
| Cerebras / Groq | 快速推理模型 |
| Ollama / LM Studio | 在本地机器上运行模型 |
| 任何 OpenAI 兼容 API | 自托管或第三方端点 |

## 通过插件或 MCP 服务器扩展

通过插件扩展 Cline 的能力。使用 SDK，通过插件系统以编程方式注册工具和生命周期钩子，用于日志记录、审计、策略执行或添加领域特定的能力。下面是一个简单的插件示例。

```typescript
import { Agent, createTool } from "@cline/sdk"

const deployTool = createTool({
  name: "deploy",
  description: "将当前分支部署到 staging 环境。",
  inputSchema: { type: "object", properties: { env: { type: "string" } }, required: ["env"] },
  execute: async (input) => {
    // 你的部署逻辑
  },
})

const agent = new Agent({ tools: [deployTool], /* ... */ })
```
...或者使用 [MCP 服务器](https://github.com/modelcontextprotocol) 连接数据库、查询 API、管理云基础设施并与外部系统交互。使用[社区构建的服务器](https://github.com/modelcontextprotocol/servers)或让 Cline 即时创建自定义工具。在 CLI 中，使用 `cline mcp` 管理服务器。

## 多智能体团队

协调多个智能体协同完成复杂任务。协调者智能体将工作分解为子任务并委派给专业智能体，每个智能体都有自己的工具和上下文。团队状态会在会话之间持久保存，因此你可以从上次离开的地方继续。

```bash
cline --team-name auth-sprint "规划并实现带测试的用户认证功能"
```

## 定时智能体

在 cron 计划上运行智能体以实现定期自动化。每日 PR 摘要、每周依赖检查、代码库健康报告。计划会在重启后持久保存，并独立于任何终端会话运行。

```bash
cline schedule create "PR 摘要" \
  --cron "0 9 * * MON-FRI" \
  --prompt "列出所有开放的 PR 及其审核状态" \
  --workspace /path/to/repo
```

## 连接 Slack、Telegram、Discord 等

从任何消息平台与你的智能体聊天：Telegram、Slack、Discord、Google Chat、WhatsApp 和 Linear。每个对话线程都会映射到一个具有完整上下文的智能体会话。设置访问控制以限制谁可以与你的智能体交互。

```bash
# 连接 Telegram
cline connect telegram -k $BOT_TOKEN
# 通过 webhook 连接 Slack
cline connect slack --bot-token $SLACK_TOKEN --signing-secret $SECRET --base-url $URL
# 使用 socket 模式连接 Slack
cline connect slack --bot-token $SLACK_TOKEN --app-token $SLACK_APP_TOKEN
```

## 用于 CI/CD 的无头 CLI

以零交互方式运行 Cline，用于脚本和自动化。管道输入、获取 JSON 输出、链式命令、集成到 CI/CD 流水线中。

```bash
cline "运行测试并修复所有失败"
git diff origin/main | cline "审查这些更改是否存在问题"
cline --json "列出所有 TODO 注释" | jq -r 'select(.type == "agent_event" and .event.text) | .event.text'
```

## 参与贡献

从[贡献指南](CONTRIBUTING.md)开始。加入我们的 [Discord](https://discord.gg/cline) 并前往 `#contributors` 频道与其他贡献者交流。查看我们的[招聘页面](https://cline.bot/join-us)了解全职岗位。

## 许可证

[Apache 2.0 © 2026 Cline Bot Inc.](./LICENSE)
