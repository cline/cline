# 🚀 MCP 快速入门指南

## ❓ 什么是 MCP 服务器？

将 MCP 服务器视为特殊助手，它们赋予 Cline 额外的能力！它们让 Cline 可以执行酷炫的操作，比如获取网页或处理你的文件。

## ⚠️ 重要：系统要求

停！在继续之前，你必须验证这些要求：

### 所需软件

-   ✅ 最新版本的 Node.js（v18 或更新版本）

    -   通过运行：`node --version` 检查
    -   从 <https://nodejs.org/> 安装

-   ✅ 最新版本的 Python（v3.8 或更新版本）

    -   通过运行：`python --version` 检查
    -   从 <https://python.org/> 安装

-   ✅ UV 包管理器
    -   安装 Python 后，运行：`pip install uv`
    -   通过：`uv --version` 验证

❗ 如果这些命令中的任何一个失败或显示旧版本，请在继续之前安装/更新！

⚠️ 如果遇到其他错误，请查看下面的“故障排除”部分。

## 🎯 快速步骤（仅在满足要求后！）

### 1. 🛠️ 安装你的第一个 MCP 服务器

1. 从 Cline 扩展中，点击 `MCP 服务器` 选项卡
1. 点击 `编辑 MCP 设置` 按钮

 <img src="https://github.com/user-attachments/assets/abf908b1-be98-4894-8dc7-ef3d27943a47" alt="MCP 服务器面板" width="400" />

1. MCP 设置文件应在 VS Code 的选项卡中显示。
1. 用以下代码替换文件内容：

对于 Windows：

```json
{
	"mcpServers": {
		"mcp-installer": {
			"command": "cmd.exe",
			"args": ["/c", "npx", "-y", "@anaisbetts/mcp-installer"]
		}
	}
}
```

对于 Mac 和 Linux：

```json
{
	"mcpServers": {
		"mcp-installer": {
			"command": "npx",
			"args": ["@anaisbetts/mcp-installer"]
		}
	}
}
```

保存文件后：

1. Cline 将自动检测到更改
2. MCP 安装程序将被下载并安装
3. Cline 将启动 MCP 安装程序
4. 你将在 Cline 的 MCP 设置 UI 中看到服务器状态：

<img src="https://github.com/user-attachments/assets/2abbb3de-e902-4ec2-a5e5-9418ed34684e" alt="带安装程序的 MCP 服务器面板" width="400" />

## 🤔 接下来做什么？

现在你有了 MCP 安装程序，你可以要求 Cline 从以下位置添加更多服务器：

1. NPM 注册表：<https://www.npmjs.com/search?q=%40modelcontextprotocol>
2. Python 包索引：<https://pypi.org/search/?q=mcp+server-&o=>

例如，你可以要求 Cline 安装在 Python 包索引上找到的 `mcp-server-fetch` 包：

```bash
"安装名为 `mcp-server-fetch` 的 MCP 服务器
- 确保 MCP 设置已更新。
- 使用 uvx 或 python 运行服务器。"
```

你应该会看到 Cline：

1. 安装 `mcp-server-fetch` Python 包
1. 更新 mcp 设置 json 文件
1. 启动服务器并启动服务器

mcp 设置文件现在应该看起来像这样：

_对于 Windows 机器：_
您始终可以通过转到客户端的 MCP 服务器选项卡来检查服务器的状态。请参见上面的图片

就是这样！🎉 您刚刚为 Cline 赋予了一些很棒的新能力！

## 📝 故障排除

### 1. 我使用 `asdf` 时收到“未知命令：npx”

有一些不太好的消息。您仍然应该能够使事情正常工作，但除非 MCP 服务器打包有所发展，否则将不得不做一些更多的手动工作。一个选项是卸载 `asdf`，但我们假设您不想这样做。

相反，您需要按照上面的说明来“编辑 MCP 设置”。然后，如[这篇文章](https://dev.to/cojiroooo/mcp-using-node-on-asdf-382n)所述，您需要在每个服务器的配置中添加一个“env”条目。

```json
"env": {
        "PATH": "/Users/<user_name>/.asdf/shims:/usr/bin:/bin",
        "ASDF_DIR": "<path_to_asdf_bin_dir>",
        "ASDF_DATA_DIR": "/Users/<user_name>/.asdf",
        "ASDF_NODEJS_VERSION": "<your_node_version>"
      }
```

`path_to_asdf_bin_dir` 通常可以在您的 shell 配置中找到（例如 `.zshrc`）。如果您使用 Homebrew，可以使用 `echo ${HOMEBREW_PREFIX}` 来找到目录的开始，然后附加 `/opt/asdf/libexec`。

现在有一些好消息。虽然不完美，但您可以让 Cline 在后续的服务器安装中相当可靠地为您完成这项工作。在 Cline 设置中（右上角工具栏按钮）的“自定义指令”中添加以下内容：

> 在安装 MCP 服务器并编辑 cline_mcp_settings.json 时，如果服务器需要使用 `npx` 作为命令，您必须从“mcp-installer”条目中复制“env”条目并将其添加到新条目中。这对于使服务器在使用时正常工作至关重要。

### 2. 运行 MCP 安装程序时我仍然收到错误

如果您在运行 MCP 安装程序时收到错误，您可以尝试以下操作：

-   检查 MCP 设置文件中的错误
-   阅读 MCP 服务器的文档，确保 MCP 设置文件使用了正确的命令和参数。👈
-   使用终端直接运行命令及其参数。这将使您能够看到 Cline 看到的相同错误。