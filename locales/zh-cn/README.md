<div align="center"><sub>
English | <a href="https://github.com/cline/cline/blob/main/locales/es/README.md" target="_blank">Español</a> | <a href="https://github.com/cline/cline/blob/main/locales/de/README.md" target="_blank">Deutsch</a> | <a href="https://github.com/cline/cline/blob/main/locales/ja/README.md" target="_blank">日本語</a> | <a href="https://github.com/cline/cline/blob/main/locales/zh-cn/README.md" target="_blank">简体中文</a> | <a href="https://github.com/cline/cline/blob/main/locales/zh-tw/README.md" target="_blank">繁體中文</a>
</sub></div>

# Cline：您的严肃工程工作的协作型AI伙伴

通过一个全协作的AI伙伴来革新您的工程团队。开源、完全可扩展，旨在放大开发者的影响力。

<p align="center">
  <video alt="Cline AI代理展示协作开发功能的演示" autoplay loop muted playsinline width="100%">
    <source src="https://media.githubusercontent.com/media/cline/cline/main/assets/docs/demoForWebsiteNew.mp4" type="video/mp4">
  </video>
</p>

<div align="center">
<table>
<tbody>
<td align="center">
<a href="https://marketplace.visualstudio.com/items?itemName=saoudrizwan.claude-dev" target="_blank"><strong>在VS Marketplace下载</strong></a>
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
<a href="https://docs.cline.bot/getting-started/getting-started-new-coders" target="_blank"><strong>快速上手</strong></a>
</td>
</tbody>
</table>
</div>

Cline不仅仅是一个自主代理——它是您在优化开发工作流程方面的AI伙伴。在采取行动之前，它会与您共同制定计划，解释其推理过程，并逐步拆解复杂任务。借助创建与编辑文件、浏览项目和执行命令等工具，Cline全程监控您的环境——从终端、文件到错误日志，确保工作顺利进行。

传统的AI脚本通常在沙盒环境中运行，而Cline提供了带有人机交互的图形界面，让您可以批准每一次文件更改和终端命令。通过整合MCP（模型上下文协议），Cline能扩展到外部数据库和实时文档，自动检测问题并应用修复，让您专注于创新。其设计考虑了企业级安全性，您可以通过AWS Bedrock、GCP Vertex或Azure终端访问顶级模型，同时确保代码安全。

1. 输入任务并添加图片，将设计稿转换为功能性应用，或通过截图修复错误。
2. Cline首先会分析您的文件结构和源代码的AST，进行正则表达式搜索并读取相关文件，以迅速了解现有项目。通过仔细管理添加到上下文中的信息，即使是大型复杂项目也能获得有价值的支持，而不会使上下文窗口超载。
3. 一旦Cline获取了必要的信息，它便可以：
    - 创建与编辑文件，同时监控linter/编译错误，从而主动修复如缺失导入和语法错误等问题。
    - 直接在终端执行命令并监控输出，例如在编辑文件后对开发服务器问题作出响应。
    - 对于网页开发任务，Cline可以在无头浏览器中启动网站，执行点击、输入和滚动操作，并捕捉截图及控制台日志，以修复运行时错误和视觉故障。
4. 当任务完成后，Cline会以类似于 `open -a "Google Chrome" index.html` 的终端命令向您展示结果，您只需点击即可执行该命令。

> [!TIP]
> 使用快捷键 `CMD/CTRL + Shift + P` 打开命令面板，输入 “Cline: Open In New Tab” 即可在编辑器中新标签页中打开扩展程序。这样您可以将Cline与文件浏览器并排使用，更清晰地查看工作区的变化。

---

<img align="right" width="340" src="https://github.com/user-attachments/assets/3cf21e04-7ce9-4d22-a7b9-ba2c595e88a4" alt="Cline灵活的模型集成界面">

### 使用任意API和模型

Cline支持OpenRouter、Anthropic、OpenAI、Google Gemini、AWS Bedrock、Azure和GCP Vertex等API提供商。您还可以配置任何兼容OpenAI的API，或通过LM Studio/Ollama使用本地模型。如果您使用OpenRouter，扩展程序会获取最新的模型列表，让您能立即使用最新模型。

扩展程序还会跟踪任务全过程以及单个请求的总token数和API使用费用，确保您时刻了解花费情况。

<!-- Transparent pixel to create line break after floating image -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="left" width="370" src="https://github.com/user-attachments/assets/81be79a8-1fdb-4028-9129-5fe055e01e76" alt="Cline终端命令执行界面">

### 在终端中执行命令

得益于[VSCode v1.93中终端集成更新](https://code.visualstudio.com/updates/v1_93#_terminal-shell-integration-api)，Cline可以直接在终端中执行命令并接收输出。这使其能执行从安装软件包、运行构建脚本到部署应用、管理数据库及执行测试等各种任务，同时适应您的开发环境和工具链，确保工作正确完成。

对于开发服务器等长时间运行的进程，请使用“运行时继续”按钮，让Cline在命令后台运行时继续任务。过程中，Cline会收到新的终端输出，从而能及时响应文件编辑时出现的编译错误等问题。

<!-- Transparent pixel to create line break after floating image -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="right" width="400" src="https://github.com/user-attachments/assets/c5977833-d9b8-491e-90f9-05f9cd38c588" alt="Cline带diff视图的文件编辑界面">

### 创建与编辑文件

Cline可以直接在您的编辑器中创建和编辑文件，并以diff视图显示所做更改。您可以在diff视图中直接编辑或撤销Cline的更改，或通过聊天反馈直到您满意为止。此外，Cline还会监控linter/编译错误（如缺失导入、语法错误等），以便自主修复问题。

所有由Cline所做的更改都会记录在文件的时间线上，便于您追踪并在必要时回退修改。

<!-- Transparent pixel to create line break after floating image -->

<img align="left" width="370" src="https://github.com/user-attachments/assets/bc2e85ba-dfeb-4fe6-9942-7cfc4703cbe5" alt="Cline浏览器自动化界面">

### 使用浏览器

借助Claude 3.5 Sonnet的新[计算机使用](https://www.anthropic.com/news/3-5-models-and-computer-use)功能，Cline可以启动浏览器、点击页面元素、输入文本和滚动，并在每个步骤捕捉截图及控制台日志。这使得交互式调试、端到端测试甚至日常网页使用成为可能，无需您手动复制粘贴错误日志，便可自动修复视觉错误及运行时问题。

试着让Cline“测试应用”，观察它如何执行如 `npm run dev` 的命令，启动本地开发服务器，并进行一系列测试以确保一切正常。[观看演示](https://x.com/sdrzn/status/1850880547825823989)

<!-- Transparent pixel to create line break after floating image -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="right" width="350" src="https://github.com/user-attachments/assets/ac0efa14-5c1f-4c26-a42d-9d7c56f5fadd" alt="Cline MCP工具创建界面">

### “添加一个工具……”

借助[Model Context Protocol](https://github.com/modelcontextprotocol)，Cline可以通过自定义工具扩展其功能。您既可以使用[社区服务器](https://github.com/modelcontextprotocol/servers)，也可以让Cline创建并安装专为您的工作流程定制的工具。只需告诉Cline“添加一个工具”，它便会处理所有操作，从创建新的MCP服务器到将其安装到扩展中。这些自定义工具将成为Cline工具箱的一部分，供未来任务使用。

- “添加一个工具来获取Jira工单”：获取工单代码并启动Cline工作。
- “添加一个工具来管理AWS EC2”：监控服务器指标，根据需要扩展或缩减实例。
- “添加一个工具来拉取最新的PagerDuty事件”：获取详细信息，并让Cline修复错误。

<!-- Transparent pixel to create line break after floating image -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="left" width="360" src="https://github.com/user-attachments/assets/7fdf41e6-281a-4b4b-ac19-020b838b6970" alt="Cline上下文管理界面">

### 添加上下文

**`@url`：** 粘贴一个URL，扩展程序会获取该链接并转换为Markdown，适用于向Cline提供最新文档。

**`@problems`：** 添加工作区错误与警告（“问题”面板），供Cline修复。

**`@file`：** 添加文件内容，节省批准读取文件所需的API请求。

**`@folder`：** 一次性添加整个文件夹中的所有文件，以进一步加速您的工作流程。

<!-- Transparent pixel to create line break after floating image -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="right" width="350" src="https://github.com/user-attachments/assets/140c8606-d3bf-41b9-9a1f-4dbf0d4c90cb" alt="Cline检查点对比界面">

### 企业级安全

在Cline执行任务时，扩展程序会在每一步捕捉工作区快照。您可以使用“比较”按钮查看快照与当前工作区的差异，并通过“恢复”按钮回到该状态。

例如，在本地开发服务器上工作时，您可以使用“仅恢复工作区”选项快速测试应用的不同版本，然后在确定要继续开发的版本后，选择“恢复任务与工作区”。这让您能够在不丢失进度的情况下安全地尝试不同方案。

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

## 贡献

要为该项目做出贡献，请先阅读我们的[贡献指南](CONTRIBUTING.md)了解基本情况。您也可以加入我们的[Discord](https://discord.gg/cline)并在`#contributors`频道与其他贡献者交流。如果您在寻找全职工作，请查看我们的[招聘页面](https://cline.bot/join-us)。

<details>
<summary>本地开发说明</summary>

1. 克隆代码库 _(需要 [git-lfs](https://git-lfs.com/))_：
    ```bash
    git clone https://github.com/cline/cline.git
    ```
2. 在VSCode中打开项目：
    ```bash
    code cline
    ```
3. 安装扩展程序及webview-gui所需依赖：
    ```bash
    npm run install:all
    ```
4. 按`F5`键（或选择“运行”→“启动调试”）以打开一个加载了扩展的新VSCode窗口。（如果在构建项目时遇到问题，可能需要安装[esbuild problem matchers扩展](https://marketplace.visualstudio.com/items?itemName=connor4312.esbuild-problem-matchers)。）

</details>

<details>
<summary>创建Pull Request</summary>

1. 在创建PR之前生成一个changeset条目：
    ```bash
    npm run changeset
    ```
   系统会要求您提供：
   - 变更类型（major, minor, patch）
     - `major` → 重大变更 (1.0.0 → 2.0.0)
     - `minor` → 新功能 (1.0.0 → 1.1.0)
     - `patch` → Bug修复 (1.0.0 → 1.0.1)
   - 您的变更描述

2. 提交您的更改及生成的`.changeset`文件

3. 推送您的分支并在GitHub上创建PR。我们的CI将：
   - 运行测试和检查
   - Changesetbot将创建一条显示版本影响的评论
   - 当合并到主分支后，Changesetbot将创建一个版本包的PR
   - 当版本包PR合并后，将发布新版本

</details>

## 许可证

[Apache 2.0 © 2025 Cline Bot Inc.](./LICENSE)
