# 开始使用 Cline | 新手程序员

欢迎使用 Cline！本指南将帮助您设置并开始使用 Cline 来构建您的第一个项目。

## 您需要的准备

在开始之前，请确保您具备以下条件：

-   **VS Code：** 一个免费且功能强大的代码编辑器。
    -   [下载 VS Code](https://code.visualstudio.com/)
-   **开发工具：** 编程必备的软件（Homebrew、Node.js、Git 等）。
    -   按照我们的 [安装必备开发工具](installing-dev-essentials.md) 指南来设置这些工具，Cline 将帮助您完成（在完成此处的设置后）
    -   Cline 将指导您安装所需的一切
-   **Cline 项目文件夹：** 专门用于所有 Cline 项目的文件夹。
    -   在 macOS 上：在您的文档文件夹中创建一个名为 "Cline" 的文件夹
        -   路径：`/Users/[your-username]/Documents/Cline`
    -   在 Windows 上：在您的文档文件夹中创建一个名为 "Cline" 的文件夹
        -   路径：`C:\Users\[your-username]\Documents\Cline`
    -   在这个 Cline 文件夹内，为每个项目创建单独的文件夹
        -   示例：`Documents/Cline/workout-app` 用于健身跟踪应用
        -   示例：`Documents/Cline/portfolio-website` 用于您的作品集
-   **VS Code 中的 Cline 扩展：** 在 VS Code 中安装的 Cline 扩展。

-   这里有一个 [教程](https://www.youtube.com/watch?v=N4td-fKhsOQ)，介绍您开始所需的一切。

## 逐步设置

按照以下步骤来启动并运行 Cline：

1. **打开 VS Code：** 启动 VS Code 应用程序。如果 VS Code 显示“运行扩展可能会...”，请点击“允许”。

2. **打开您的 Cline 文件夹：** 在 VS Code 中，打开您在文档中创建的 Cline 文件夹。

3. **导航到扩展：** 点击 VS Code 侧边活动栏中的扩展图标。

4. **搜索 'Cline'：** 在扩展搜索栏中输入 "Cline"。

5. **安装扩展：** 点击 Cline 扩展旁边的“安装”按钮。

6. **打开 Cline：** 安装后，您可以通过几种方式打开 Cline：
    - 点击活动栏中的 Cline 图标。
    - 使用命令面板（`CMD/CTRL + Shift + P`）并输入 "Cline: 在新标签页中打开"，以在编辑器中作为标签页打开 Cline。这是为了获得更好的视图而推荐的。
    - **故障排除：** 如果您没有看到 Cline 图标，请尝试重启 VS Code。
    - **您将看到什么：** 您应该会在 VS Code 编辑器中看到 Cline 聊天窗口。

![gettingStartedVsCodeCline](https://github.com/user-attachments/assets/622b4bb7-859b-4c2e-b87b-c12e3eabefb8)

## 设置 OpenRouter API 密钥

现在您已经安装了 Cline，您需要设置您的 OpenRouter API 密钥以使用 Cline 的全部功能。
1.  **获取您的 OpenRouter API 密钥：**
    -   [获取您的 OpenRouter API 密钥](https://openrouter.ai/)
2.  **输入您的 OpenRouter API 密钥：**
    -   导航到 Cline 扩展中的设置按钮。
    -   输入您的 OpenRouter API 密钥。
    -   选择您偏好的 API 模型。
        -   **推荐用于编程的模型：**
            -   `anthropic/claude-3.5-sonnet`：最常用于编程任务。
            -   `google/gemini-2.0-flash-exp:free`：用于编程的免费选项。
            -   `deepseek/deepseek-chat`：超级便宜，几乎与 3.5 sonnet 一样好
        -   [OpenRouter 模型排名](https://openrouter.ai/rankings/programming)

## 您与 Cline 的第一次互动

现在您已经准备好开始使用 Cline 构建了。让我们创建您的第一个项目文件夹并构建一些东西！将以下提示复制并粘贴到 Cline 聊天窗口中：

```
嘿 Cline！你能帮我在我的 Cline 目录中创建一个名为 "hello-world" 的新项目文件夹，并制作一个显示 "Hello World" 的大蓝色文本的简单网页吗？
```

**您将看到什么：** Cline 将帮助您创建项目文件夹并设置您的第一个网页。

## 使用 Cline 的提示

-   **提问：** 如果您对某事不确定，请不要犹豫，向 Cline 提问！
-   **使用截图：** Cline 可以理解图像，所以请随意使用截图来展示您正在处理的内容。
-   **复制并粘贴错误：** 如果您遇到错误，请将错误消息复制并粘贴到 Cline 的聊天中。这将帮助他理解问题并提供解决方案。
-   **使用简单语言：** Cline 设计为理解简单、非技术性的语言。请随意用您自己的话描述您的想法，Cline 将把它们翻译成代码。

## 常见问题

-   **什么是终端？** 终端是一个基于文本的界面，用于与您的计算机交互。它允许您运行命令来执行各种任务，例如安装软件包、运行脚本和管理文件。Cline 使用终端来执行命令并与您的开发环境交互。
-   **代码库是如何工作的？** （本节将根据新程序员的常见问题进行扩展）

## 仍然有困难？

请随时联系我，我将帮助您开始使用 Cline。

nick | 608-558-2410

加入我们的 Discord 社区：[https://discord.gg/cline](https://discord.gg/cline)