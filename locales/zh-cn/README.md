# Cline – OpenRouter 排名第一

<p align="center">
    <img src="https://media.githubusercontent.com/media/cline/cline/main/assets/docs/demo.gif" width="100%" />
</p>

<div align="center">
<table>
<tbody>
<td align="center">
<a href="https://marketplace.visualstudio.com/items?itemName=saoudrizwan.claude-dev" target="_blank"><strong>在 VS Marketplace 下载</strong></a>
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
<a href="https://cline.bot/join-us" target="_blank"><strong>我们正在招聘！</strong></a>
</td>
</tbody>
</table>
</div>

认识 Cline，一个可以使用你的 **CLI** 和 **编辑器** 的 AI 助手。

感谢 [Claude 3.5 Sonnet 的代理编码能力](https://www-cdn.anthropic.com/fed9cc193a14b84131812372d8d5857f8f304c52/Model_Card_Claude_3_Addendum.pdf)，Cline 可以一步步处理复杂的软件开发任务。通过允许他创建和编辑文件、探索大型项目、使用浏览器和执行终端命令（在你授予权限后），他可以提供超越代码完成或技术支持的帮助。Cline 甚至可以使用 Model Context Protocol (MCP) 创建新工具并扩展自己的能力。虽然自主 AI 脚本传统上在沙盒环境中运行，但此扩展提供了一个人机交互的 GUI 来批准每个文件更改和终端命令，提供了一种安全且可访问的方式来探索代理 AI 的潜力。

1. 输入你的任务并添加图像，将模型转换为功能应用程序或通过截图修复错误。
2. Cline 首先分析你的文件结构和源代码 AST，运行正则表达式搜索，并阅读相关文件以了解现有项目。通过仔细管理添加到上下文中的信息，Cline 即使在大型复杂项目中也能提供有价值的帮助，而不会使上下文窗口过载。
3. 一旦 Cline 获得所需信息，他可以：
        - 创建和编辑文件 + 监控 linter/编译器错误，从而主动修复诸如缺少导入和语法错误等问题。
        - 直接在你的终端中执行命令并监控其输出，从而在编辑文件后对开发服务器问题做出反应。
        - 对于 Web 开发任务，Cline 可以在无头浏览器中启动网站，点击、输入、滚动并捕获截图和控制台日志，从而修复运行时错误和视觉错误。
4. 当任务完成时，Cline 将通过终端命令如 `open -a "Google Chrome" index.html` 向你展示结果，你可以通过点击按钮运行该命令。

> [!提示]
> 使用 `CMD/CTRL + Shift + P` 快捷键打开命令面板并输入 "Cline: Open In New Tab" 将扩展作为标签在编辑器中打开。这让你可以与文件资源管理器并排使用 Cline，更清楚地看到他如何改变你的工作空间。

---

<img align="right" width="340" src="https://github.com/user-attachments/assets/3cf21e04-7ce9-4d22-a7b9-ba2c595e88a4">

### 使用任何 API 和模型

Cline 支持 OpenRouter、Anthropic、OpenAI、Google Gemini、AWS Bedrock、Azure 和 GCP Vertex 等 API 提供商。你还可以配置任何兼容 OpenAI 的 API，或通过 LM Studio/Ollama 使用本地模型。如果你使用 OpenRouter，扩展会获取他们的最新模型列表，让你在新模型可用时立即使用。

扩展还会跟踪整个任务循环和单个请求的总令牌和 API 使用成本，让你在每一步都了解支出情况。

<!-- 透明像素以在浮动图像后创建换行 -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="left" width="370" src="https://github.com/user-attachments/assets/81be79a8-1fdb-4028-9129-5fe055e01e76">

### 在终端中运行命令

感谢 VSCode v1.93 中的新 [终端 shell 集成更新](https://code.visualstudio.com/updates/v1_93#_terminal-shell-integration-api)，Cline 可以直接在你的终端中执行命令并接收输出。这使他能够执行广泛的任务，从安装包和运行构建脚本到部署应用程序、管理数据库和执行测试，同时适应你的开发环境和工具链以正确完成工作。

对于长时间运行的进程如开发服务器，使用“在运行时继续”按钮让 Cline 在命令后台运行时继续任务。当 Cline 工作时，他会在过程中收到任何新的终端输出通知，让他对可能出现的问题做出反应，例如编辑文件时的编译时错误。

<!-- 透明像素以在浮动图像后创建换行 -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="right" width="400" src="https://github.com/user-attachments/assets/c5977833-d9b8-491e-90f9-05f9cd38c588">

### 创建和编辑文件

Cline 可以直接在你的编辑器中创建和编辑文件，向你展示更改的差异视图。你可以直接在差异视图编辑器中编辑或恢复 Cline 的更改，或在聊天中提供反馈，直到你对结果满意。Cline 还会监控 linter/编译器错误（缺少导入、语法错误等），以便他在过程中自行修复出现的问题。

Cline 所做的所有更改都会记录在你的文件时间轴中，提供了一种简单的方法来跟踪和恢复修改（如果需要）。

<!-- 透明像素以在浮动图像后创建换行 -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="left" width="370" src="https://github.com/user-attachments/assets/bc2e85ba-dfeb-4fe6-9942-7cfc4703cbe5">

### 使用浏览器

借助 Claude 3.5 Sonnet 的新 [计算机使用](https://www.anthropic.com/news/3-5-models-and-computer-use) 功能，Cline 可以启动浏览器，点击元素，输入文本和滚动，在每一步捕获截图和控制台日志。这允许进行交互式调试、端到端测试，甚至是一般的网页使用！这使他能够自主修复视觉错误和运行时问题，而无需你亲自操作和复制粘贴错误日志。

试试让 Cline “测试应用程序”，看看他如何运行 `npm run dev` 命令，在浏览器中启动你本地运行的开发服务器，并执行一系列测试以确认一切正常。[在这里查看演示。](https://x.com/sdrzn/status/1850880547825823989)

<!-- 透明像素以在浮动图像后创建换行 -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="right" width="350" src="https://github.com/user-attachments/assets/ac0efa14-5c1f-4c26-a42d-9d7c56f5fadd">

### “添加一个工具……”

感谢 [Model Context Protocol](https://github.com/modelcontextprotocol)，Cline 可以通过自定义工具扩展他的能力。虽然你可以使用 [社区制作的服务器](https://github.com/modelcontextprotocol/servers)，但 Cline 可以创建和安装适合你特定工作流程的工具。只需让 Cline “添加一个工具”，他将处理所有事情，从创建新的 MCP 服务器到将其安装到扩展中。这些自定义工具将成为 Cline 工具包的一部分，准备在未来的任务中使用。

- “添加一个获取 Jira 工单的工具”：检索工单 AC 并让 Cline 开始工作
- “添加一个管理 AWS EC2 的工具”：检查服务器指标并上下扩展实例
- “添加一个获取最新 PagerDuty 事件的工具”：获取详细信息并让 Cline 修复错误

<!-- 透明像素以在浮动图像后创建换行 -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="left" width="360" src="https://github.com/user-attachments/assets/7fdf41e6-281a-4b4b-ac19-020b838b6970">

### 添加上下文

**`@url`：** 粘贴一个 URL 以供扩展获取并转换为 markdown，当你想给 Cline 提供最新文档时非常有用

**`@problems`：** 添加工作区错误和警告（“问题”面板）以供 Cline 修复

**`@file`：** 添加文件内容，这样你就不必浪费 API 请求批准读取文件（+ 输入以搜索文件）

**`@folder`：** 一次添加文件夹的文件，以进一步加快你的工作流程

<!-- 透明像素以在浮动图像后创建换行 -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="right" width="350" src="https://github.com/user-attachments/assets/140c8606-d3bf-41b9-9a1f-4dbf0d4c90cb">

### 检查点：比较和恢复

当 Cline 完成任务时，扩展会在每一步拍摄你的工作区快照。你可以使用“比较”按钮查看快照和当前工作区之间的差异，并使用“恢复”按钮回滚到该点。

例如，当使用本地 Web 服务器时，你可以使用“仅恢复工作区”快速测试应用程序的不同版本，然后在找到要继续构建的版本时使用“恢复任务和工作区”。这让你可以安全地探索不同的方法而不会丢失进度。

<!-- 透明像素以在浮动图像后创建换行 -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

## 贡献

要为项目做出贡献，请从我们的 [贡献指南](CONTRIBUTING.md) 开始，了解基础知识。你还可以加入我们的 [Discord](https://discord.gg/cline) 在 `#contributors` 频道与其他贡献者聊天。如果你正在寻找全职工作，请查看我们在 [招聘页面](https://cline.bot/join-us) 上的开放职位！

<details>
<summary>本地开发说明</summary>

1. 克隆仓库 _(需要 [git-lfs](https://git-lfs.com/))_：
        ```bash
        git clone https://github.com/cline/cline.git
        ```
2. 在 VSCode 中打开项目：
        ```bash
        code cline
        ```
3. 安装扩展和 webview-gui 的必要依赖：
        ```bash
        npm run install:all
        ```
4. 按 `F5`（或 `运行`->`开始调试`）启动以打开一个加载了扩展的新 VSCode 窗口。（如果你在构建项目时遇到问题，可能需要安装 [esbuild problem matchers 扩展](https://marketplace.visualstudio.com/items?itemName=connor4312.esbuild-problem-matchers)）

</details>

## 许可证

[Apache 2.0 © 2024 Cline Bot Inc.](./LICENSE)

