<div align="center"><sub>
<a href="../../README.md" target="_blank">English</a> | <a href="../es/README.md" target="_blank">Español</a> | <a href="../de/README.md" target="_blank">Deutsch</a> | <a href="../ja/README.md" target="_blank">日本語</a> | 简体中文 | <a href="../zh-tw/README.md" target="_blank">繁體中文</a> | <a href="../ko/README.md" target="_blank">한국어</a>
</sub></div>

# Cline

<p align="center">
  <img src="https://media.githubusercontent.com/media/cline/cline/main/assets/docs/demo.gif" width="100%" />
</p>

<div align="center">
<table>
<tbody>
<td align="center">
<a href="https://marketplace.visualstudio.com/items?itemName=saoudrizwan.claude-dev" target="_blank"><strong>在 VS Marketplace 上下载</strong></a>
</td>
<td align="center">
<a href="https://discord.gg/cline" target="_blank"><strong>Discord</strong></a>
</td>
<td align="center">
<a href="https://www.reddit.com/r/cline/" target="_blank"><strong>r/cline</strong></a>
</td>
<td align="center">
<a href="https://github.com/cline/cline/discussions/categories/feature-requests?discussions_q=is%3Aopen+category%3A%22Feature+Requests%22+sort%3Atop" target="_blank"><strong>功能请求</strong></a>
</td>
<td align="center">
<a href="https://docs.cline.bot/getting-started/for-new-coders" target="_blank"><strong>快速入门</strong></a>
</td>
</tbody>
</table>
</div>

认识一下 Cline，一个可以使用您的 **CLI** 且拥有代码**编辑**能力的 AI 助手。

得益于 [Claude Sonnet 的 Agentic（代理化）编程能力](https://www.anthropic.com/claude/sonnet)，Cline 可以逐步处理复杂的软件开发任务。在获得您的许可后，他可以创建和编辑文件、探索大型项目、使用浏览器以及执行终端命令，这使得他的协助远超普通的代码补全或技术支持。Cline 甚至可以使用模型上下文协议 (MCP) 创建新工具来扩展自己的功能。虽然传统的自主 AI 脚本通常在沙盒环境中运行，但此扩展提供了一个人在回路 (human-in-the-loop) 的图形界面，由您批准每一次文件更改和终端命令，从而为您提供了一种安全、易用的方式来探索 Agentic AI 的潜力。

1. 输入您的任务，您还可以添加图片（比如将设计草图转换为功能性应用，或者带截图修复 Bug）。
2. Cline 首先会通过分析您的文件结构和源代码 AST、运行正则表达式搜索以及读取相关文件，来快速熟悉现有项目。通过精心管理添加到上下文中的信息，Cline 即便面对庞大复杂的项目，也能在不超出上下文窗口限制的情况下提供有价值的帮助。
3. 一旦 Cline 获取了所需的信息，他就可以：
    - 创建和编辑文件，同时在此过程中监控 linter/编译器错误，使他能够主动发现并自行修复诸如缺失导入或语法错误等问题。
    - 直接在您的终端中执行命令，并在工作时监控命令输出。例如，在编辑文件后如果遇到开发服务器报错，他能根据日志立即做出反应。
    - 对于 Web 开发任务，Cline 可以在无头浏览器 (headless browser) 中启动网站，进行点击、输入、滚动操作，并捕获每一步的截图和控制台日志，这使他能够自动修复运行时错误和视觉 Bug。
4. 任务完成后，Cline 会向您展示结果，并附带一个终端命令（如 `open -a "Google Chrome" index.html`），您只需点击一下按钮即可运行。

> [!TIP]
> 按照[本指南](https://docs.cline.bot/features/customization/opening-cline-in-sidebar)将 Cline 在编辑器的右侧面板打开。这样您可以将 Cline 与您的文件资源管理器并排使用，从而更清晰地看到他是如何更改您的工作区的。

---

<img align="right" width="340" src="https://github.com/user-attachments/assets/3cf21e04-7ce9-4d22-a7b9-ba2c595e88a4">

### 使用任意 API 和模型

Cline 支持多种 API 提供商，如 OpenRouter, Anthropic, OpenAI, Google Gemini, AWS Bedrock, Azure, GCP Vertex, Cerebras 和 Groq。您还可以配置任何与 OpenAI 兼容的 API，或者通过 LM Studio/Ollama 使用本地模型。如果您使用 OpenRouter，扩展程序会获取他们最新的模型列表，让您可以第一时间用上最新的模型。

扩展程序还会跟踪整个任务循环和单个请求中的总 Token 数以及 API 使用成本，让您对每一步的开销都了如指掌。

<!-- 浮动图片后用来创建换行的透明像素 -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="left" width="370" src="https://github.com/user-attachments/assets/81be79a8-1fdb-4028-9129-5fe055e01e76">

### 在终端中运行命令

得益于 [VSCode v1.93 中更新的终端 Shell 集成 API](https://code.visualstudio.com/updates/v1_93#_terminal-shell-integration-api)，Cline 可以直接在您的终端中执行命令并接收输出。这使得他能够执行各种任务——从安装包、运行构建脚本，到部署应用程序、管理数据库以及执行测试，同时自动适应您的开发环境和工具链以确保正确完成任务。

对于长时间运行的进程（例如开发服务器），您可以使用 "Proceed While Running (在运行中继续)" 按钮，让 Cline 在后台运行该命令的同时继续处理任务。当 Cline 工作时，他会收到关于任何新终端输出的通知，这使得他能够对过程中出现的问题（例如编辑文件时的编译时错误）做出反应。

<!-- 浮动图片后用来创建换行的透明像素 -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="right" width="400" src="https://github.com/user-attachments/assets/c5977833-d9b8-491e-90f9-05f9cd38c588">

### 创建和编辑文件

Cline 可以直接在您的编辑器中创建和编辑文件，向您呈现更改的差异视图 (diff view)。您可以直接在差异视图编辑器中编辑或还原 Cline 的更改，或者在聊天中提供反馈，直到您对结果满意为止。Cline 还会监控 linter/编译器错误（缺失导入、语法错误等），以便他能够自行修复过程中出现的问题。

Cline 所做的所有更改都会记录在文件的“时间线 (Timeline)”中，这为您提供了一种如果需要的话可以轻松追踪和还原修改的方法。

<!-- 浮动图片后用来创建换行的透明像素 -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="left" width="370" src="https://github.com/user-attachments/assets/bc2e85ba-dfeb-4fe6-9942-7cfc4703cbe5">

### 使用浏览器

借助于 Claude Sonnet 全新的[计算机使用 (Computer Use)](https://www.anthropic.com/news/3-5-models-and-computer-use) 功能，Cline 可以启动浏览器、点击元素、输入文本和滚动页面，在每一步中捕获屏幕截图和控制台日志。这使得他可以进行交互式调试、端到端测试，甚至常规的网络使用！这赋予了他修复视觉 Bug 和运行时问题的自主权，而不需要您亲自去复制粘贴错误日志。

尝试让 Cline "测试应用程序"，然后观察他如何运行类似 `npm run dev` 的命令，在浏览器中启动您本地运行的开发服务器，并执行一系列测试以确认一切正常运行。[在此处查看演示视频。](https://x.com/sdrzn/status/1850880547825823989)

<!-- 浮动图片后用来创建换行的透明像素 -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="right" width="350" src="https://github.com/user-attachments/assets/ac0efa14-5c1f-4c26-a42d-9d7c56f5fadd">

### "add a tool that... (添加一个工具...)"

得益于 [Model Context Protocol (模型上下文协议)](https://github.com/modelcontextprotocol)，Cline 可以通过自定义工具扩展其功能。虽然您可以直接使用[社区制作的服务器](https://github.com/modelcontextprotocol/servers)，但 Cline 能够根据您的特定工作流为您量身定制并安装工具。只需让 Cline "add a tool (添加一个工具)"，他就会处理一切——从创建一个新的 MCP 服务器到将其安装到扩展中。这些自定义工具随后将成为 Cline 工具包的一部分，随时准备在未来的任务中使用。

-   "add a tool that fetches Jira tickets (添加一个拉取 Jira 任务单的工具)": 检索任务单的验收标准 (AC) 并让 Cline 开始工作。
-   "add a tool that manages AWS EC2s (添加一个管理 AWS EC2 的工具)": 检查服务器指标并扩展或缩减实例。
-   "add a tool that pulls the latest PagerDuty incidents (添加一个拉取最新 PagerDuty 事件的工具)": 获取详细信息并要求 Cline 修复 Bug。

<!-- 浮动图片后用来创建换行的透明像素 -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="left" width="360" src="https://github.com/user-attachments/assets/7fdf41e6-281a-4b4b-ac19-020b838b6970">

### 引入上下文

**`@url`:** 粘贴一个 URL 链接，扩展程序会去抓取并转换为 Markdown，当您想给 Cline 提供最新文档时非常有用。

**`@problems`:** 添加工作区的错误和警告（即“问题”面板中的内容），让 Cline 去修复它们。

**`@file`:** 添加指定文件的内容，这样您就不必浪费 API 请求去批准 Cline 的“读取文件”操作了（支持输入以进行文件搜索）。

**`@folder`:** 一次性添加整个文件夹下的文件内容，进一步加速您的工作流。

<!-- 浮动图片后用来创建换行的透明像素 -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="right" width="350" src="https://github.com/user-attachments/assets/140c8606-d3bf-41b9-9a1f-4dbf0d4c90cb">

### 检查点：比较与还原 (Checkpoints)

随着 Cline 处理任务，扩展程序会在每一步对您的工作区进行快照。您可以使用 'Compare (比较)' 按钮查看快照与当前工作区之间的差异，也可以使用 'Restore (还原)' 按钮回滚到该快照的状态。

例如，在开发本地 Web 服务器时，您可以使用 'Restore Workspace Only (仅还原工作区)' 快速测试应用的不同版本，当找到您想要继续构建的版本时，再使用 'Restore Task and Workspace (还原任务和工作区)'。这使您可以安全地探索不同的解决方案，而无需担心丢失进度。

<!-- 浮动图片后用来创建换行的透明像素 -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

## 参与贡献

如果您想为本项目做出贡献，请从我们的[贡献指南 (Contributing Guide)](../../CONTRIBUTING.md)开始学习基础知识。您也可以加入我们的 [Discord](https://discord.gg/cline)，在 `#contributors` 频道中与其他贡献者交流。如果您正在寻找全职工作，请在我们的[招聘页面](https://cline.bot/join-us)上查看我们的空缺职位！

## 企业版 (Enterprise)

获得相同的 Cline 体验，并带有企业级的控制功能：SSO (SAML/OIDC)、全局策略和配置、带有审计跟踪的监控、私有网络 (VPC/private link)、自托管或本地部署选项，以及企业级技术支持。了解更多信息，请访问我们的[企业版页面](https://cline.bot/enterprise)或直接[联系我们](https://cline.bot/contact-sales)。


## 许可证 (License)

[Apache 2.0 © 2026 Cline Bot Inc.](../../LICENSE)
