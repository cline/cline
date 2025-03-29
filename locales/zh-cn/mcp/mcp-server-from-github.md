# 从 GitHub 存储库构建 MCP 服务器

本指南提供了使用 Cline 从 GitHub 存储库构建现有 MCP 服务器的逐步演练。

## **查找 MCP 服务器**

在线上有多个地方可以找到 MCP 服务器：

-   **Cline 可以自动将 MCP 服务器添加到其列表中，您可以对其进行编辑。** Cline 可以直接从 GitHub 克隆存储库并为您构建服务器。
-   **GitHub：** 在 GitHub 上查找 MCP 服务器的两个最常见的地方包括：
    -   [官方 MCP 服务器存储库](https://github.com/modelcontextprotocol/servers)
    -   [Awesome-MCP 服务器存储库](https://github.com/punkpeye/awesome-mcp-servers)
-   **在线目录：** 几个网站列出了 MCP 服务器，包括：

    -   [mcpservers.org](https://mcpservers.org/)
    -   [mcp.so](https://mcp.so/)
    -   [glama.ai/mcp/servers](https://glama.ai/mcp/servers)

    这些目录允许用户按各种标准对服务器进行排序，例如下载量、日期、星级和使用案例。每个条目提供的信息包括功能、工具和配置说明。

-   **PulseMCP：** 该网站有一篇博客文章讨论了 AI 如何使用 MCP 服务器使网站过时。PulseMCP 还包括一个关于 MCP 服务器的常见问题解答部分：[https://www.pulsemcp.com/](https://www.pulsemcp.com/)

## **使用 Cline 构建**

1.  **启动流程：** 向 Cline 提供以下信息：
    -   **GitHub 存储库 URL：** 服务器存储库的 URL。
    -   **README.md 内容：** 这是可选的，但有助于 Cline 了解服务器的用途和配置。您可以从 GitHub 存储库中复制 README.md 文件。
2.  **与 Cline 的示例交互：**

    ```
    User: "Cline，我想添加用于 Brave 浏览器控制的 MCP 服务器。这里是 GitHub 链接：https://github.com/modelcontextprotocol/servers/tree/main/src/brave 你能添加它吗？"

    Cline: "好的。正在将存储库克隆到 MCP 目录中。由于它包含 'package.json' 文件，需要构建。你要我运行 'npm run build' 吗？"

    User: "是的，构建它。"

    Cline: "构建完成。这个服务器需要浏览器路径。你的 Brave 浏览器可执行文件在哪里？"

    User: "它在 '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'。"

    Cline: "好的。我已经用那个路径更新了服务器配置，并将其添加到 'cline_mcp_settings.json' 中。还有其他需要的吗？"

    User: "没有了，就这样。我们来测试一下。"

    Cline: "很好！启动 MCP 检查器来测试服务器连接。之后，我们可以尝试从 Cline 控制浏览器。"
    ```
3. **Cline的操作：** 根据您的指令，Cline将执行以下操作：
    - **克隆仓库：** Cline将仓库克隆到您的本地机器，通常在您配置中指定的目录中。
    - **调整：** 您可以指导Cline修改服务器的配置。例如：
        - **用户：** “这个服务器需要一个API密钥。你能找到它应该添加的位置吗？”
        - Cline可能会根据您的指令自动更新`cline_mcp_settings.json`文件或其他相关文件。
    - **构建服务器：** Cline将运行适用于服务器的构建命令，通常是`npm run build`。
    - **添加服务器到设置：** Cline将服务器的配置添加到`cline_mcp_settings.json`文件中。

## **测试和故障排除**

1. **测试服务器：** 一旦Cline完成构建过程，请测试服务器以确保其按预期工作。如果遇到任何问题，Cline可以帮助您。
2. **MCP检查器：** 您可以使用MCP检查器来测试服务器的连接和功能。

## **最佳实践**

- **了解基础知识：** 虽然Cline简化了流程，但了解服务器代码、MCP协议以及如何配置服务器的基础知识是有益的。这允许更有效的故障排除和定制。
- **明确指令：** 在整个过程中向Cline提供清晰且具体的指令。
- **测试：** 在安装和配置后彻底测试服务器，以确保其正确运行。
- **版本控制：** 使用版本控制系统（如Git）来跟踪服务器代码的更改。
- **保持更新：** 保持您的MCP服务器更新，以从最新的功能和安全补丁中受益。