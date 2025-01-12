# Roo-Cline

A fork of Cline, an autonomous coding agent, with some additional experimental features. It’s been mainly writing itself recently, with a light touch of human guidance here and there.

## New in 3.0 - chat modes!

You can now choose between different prompts for Roo Cline to better suit your workflow. Here’s what’s available:

- **Code:** (existing behavior): The default mode where Cline helps you write code and execute tasks.

- **Architect:** "You are Cline, a software architecture expert..." Ideal for thinking through high-level technical design and system architecture. Can’t write code or run commands.

- **Ask:** "You are Cline, a knowledgeable technical assistant..." Perfect for asking questions about the codebase or digging into concepts. Also can’t write code or run commands.

**Switching Modes:**
It’s super simple! There’s a dropdown in the bottom left of the chat input to switch modes. Right next to it, you’ll find a way to switch between the API configuration profiles associated with the current mode (configured on the settings screen).

**Why Add This?**
- It keeps Cline from being overly eager to jump into solving problems when you just want to think or ask questions.
- Each mode remembers the API configuration you last used with it. For example, you can use more thoughtful models like OpenAI o1 for Architect and Ask, while sticking with Sonnet or DeepSeek for coding tasks.
- It builds on research suggesting better results when separating "thinking" from "coding," explained well in this very thoughtful [article](https://aider.chat/2024/09/26/architect.html) from aider.

Right now, switching modes is a manual process. In the future, I’d love to give Cline the ability to suggest mode switches based on context. For now, I’d really appreciate your feedback on this feature.

Give it a try and let us know what you think in the reddit: https://www.reddit.com/r/roocline 🚀

## Experimental Features

- Different chat modes for coding, architecting code, and asking questions about the codebase
- Drag and drop images into chats
- Delete messages from chats
- @-mention Git commits to include their context in the chat
- Save different API configurations to quickly switch between providers and settings
- "Enhance prompt" button (OpenRouter models only for now)
- Sound effects for feedback
- Option to use browsers of different sizes and adjust screenshot quality
- Quick prompt copying from history
- OpenRouter compression support
- Includes current time in the system prompt
- Uses a file system watcher to more reliably watch for file system changes
- Language selection for Cline's communication (English, Japanese, Spanish, French, German, and more)
- Support for DeepSeek V3
- Support for Amazon Nova and Meta 3, 3.1, and 3.2 models via AWS Bedrock
- Support for Glama
- Support for listing models from OpenAI-compatible providers
- Support for adding OpenAI-compatible models with or without streaming
- Per-tool MCP auto-approval
- Enable/disable individual MCP servers
- Enable/disable the MCP feature overall
- Automatically retry failed API requests with a configurable delay
- Configurable delay after auto-writes to allow diagnostics to detect potential problems
- Control the number of terminal output lines to pass to the model when executing commands
- Runs alongside the original Cline

## Disclaimer

**Please note** that Roo Veterinary, Inc does **not** make any representations or warranties regarding any code, models, or other tools provided or made available in connection with Roo-Cline, any associated third-party tools, or any resulting outputs. You assume **all risks** associated with the use of any such tools or outputs; such tools are provided on an **"AS IS"** and **"AS AVAILABLE"** basis. Such risks may include, without limitation, intellectual property infringement, cyber vulnerabilities or attacks, bias, inaccuracies, errors, defects, viruses, downtime, property loss or damage, and/or personal injury. You are solely responsible for your use of any such tools or outputs (including, without limitation, the legality, appropriateness, and results thereof).

## Demo

Here's an example of Roo-Cline autonomously creating a snake game with "Always approve write operations" and "Always approve browser actions" turned on:

https://github.com/user-attachments/assets/c2bb31dc-e9b2-4d73-885d-17f1471a4987

## Contributing
To contribute to the project, start by exploring [open issues](https://github.com/RooVetGit/Roo-Cline/issues) or checking our [feature request board](https://github.com/cline/cline/discussions/categories/feature-requests?discussions_q=is%3Aopen+category%3A%22Feature+Requests%22+sort%3Atop). We'd also love to have you join the [Roo Cline Reddit](https://www.reddit.com/r/roocline/) and the [Cline Discord](https://discord.gg/cline) to share ideas and connect with other contributors.

<details>
<summary>Local Setup</summary>

1. Install dependencies:
   ```bash
   npm run install:all
   ```

2. Build the VSIX file:
   ```bash
   npm run build
   ```
3. The new VSIX file will be created in the `bin/` directory
4. Install the extension from the VSIX file as described below:

   - **Option 1:** Drag and drop the `.vsix` file into your VSCode-compatible editor's Extensions panel (Cmd/Ctrl+Shift+X).

   - **Option 2:** Install the plugin using the CLI, make sure you have your VSCode-compatible CLI installed and in your `PATH` variable. Cursor example: `export PATH="$PATH:/Applications/Cursor.app/Contents/MacOS"`

    ```bash
    # Ex: cursor --install-extension bin/roo-cline-2.0.1.vsix
    # Ex: code --install-extension bin/roo-cline-2.0.1.vsix
    ```

5. Launch by pressing `F5` (or `Run`->`Start Debugging`) to open a new VSCode window with the extension loaded. (You may need to install the [esbuild problem matchers extension](https://marketplace.visualstudio.com/items?itemName=connor4312.esbuild-problem-matchers) if you run into issues building the project.)

</details>

<details>
<summary>Publishing</summary>
We use [changesets](https://github.com/changesets/changesets) for versioning and publishing this package. To make changes:

1. Create a PR with your changes
2. Create a new changeset by running `npm run changeset`
   - Select the appropriate kind of change - `patch` for bug fixes, `minor` for new features, or `major` for breaking changes
   - Write a clear description of your changes that will be included in the changelog
3. Get the PR approved and pass all checks
4. Merge it

Once your merge is successful:
- The release workflow will automatically create a new "Changeset version bump" PR
- This PR will:
  - Update the version based on your changeset
  - Update the `CHANGELOG.md` file
  - Create a git tag
- The PR will be automatically approved and merged
- A new version and git release will be published

</details>

---

# Cline (prev. Claude Dev) – [#1 on OpenRouter](https://openrouter.ai/)

<p align="center">
  <img src="https://media.githubusercontent.com/media/cline/cline/main/assets/docs/demo.gif" width="100%" />
</p>

<div align="center">
<table>
<tbody>
<td align="center">
<a href="https://marketplace.visualstudio.com/items?itemName=saoudrizwan.claude-dev" target="_blank"><strong>Download on VS Marketplace</strong></a>
</td>
<td align="center">
<a href="https://discord.gg/cline" target="_blank"><strong>Join the Discord</strong></a>
</td>
<td align="center">
<a href="https://github.com/cline/cline/discussions/categories/feature-requests?discussions_q=is%3Aopen+category%3A%22Feature+Requests%22+sort%3Atop" target="_blank"><strong>Feature Requests</strong></a>
</td>
<td align="center">
<a href="https://cline.bot/join-us" target="_blank"><strong>We're Hiring!</strong></a>
</td>
</tbody>
</table>
</div>

Meet Cline, an AI assistant that can use your **CLI** a**N**d **E**ditor.

Thanks to [Claude 3.5 Sonnet's agentic coding capabilities](https://www-cdn.anthropic.com/fed9cc193a14b84131812372d8d5857f8f304c52/Model_Card_Claude_3_Addendum.pdf), Cline can handle complex software development tasks step-by-step. With tools that let him create & edit files, explore large projects, use the browser, and execute terminal commands (after you grant permission), he can assist you in ways that go beyond code completion or tech support. Cline can even use the Model Context Protocol (MCP) to create new tools and extend his own capabilities. While autonomous AI scripts traditionally run in sandboxed environments, this extension provides a human-in-the-loop GUI to approve every file change and terminal command, providing a safe and accessible way to explore the potential of agentic AI.

1. Enter your task and add images to convert mockups into functional apps or fix bugs with screenshots.
2. Cline starts by analyzing your file structure & source code ASTs, running regex searches, and reading relevant files to get up to speed in existing projects. By carefully managing what information is added to context, Cline can provide valuable assistance even for large, complex projects without overwhelming the context window.
3. Once Cline has the information he needs, he can:
    - Create and edit files + monitor linter/compiler errors along the way, letting him proactively fix issues like missing imports and syntax errors on his own.
    - Execute commands directly in your terminal and monitor their output as he works, letting him e.g., react to dev server issues after editing a file.
    - For web development tasks, Cline can launch the site in a headless browser, click, type, scroll, and capture screenshots + console logs, allowing him to fix runtime errors and visual bugs.
4. When a task is completed, Cline will present the result to you with a terminal command like `open -a "Google Chrome" index.html`, which you run with a click of a button.

> [!TIP]
> Use the `CMD/CTRL + Shift + P` shortcut to open the command palette and type "Cline: Open In New Tab" to open the extension as a tab in your editor. This lets you use Cline side-by-side with your file explorer, and see how he changes your workspace more clearly.

---

<img align="right" width="340" src="https://github.com/user-attachments/assets/3cf21e04-7ce9-4d22-a7b9-ba2c595e88a4">

### Use any API and Model

Cline supports API providers like OpenRouter, Anthropic, Glama, OpenAI, Google Gemini, AWS Bedrock, Azure, and GCP Vertex. You can also configure any OpenAI compatible API, or use a local model through LM Studio/Ollama. If you're using OpenRouter, the extension fetches their latest model list, allowing you to use the newest models as soon as they're available.

The extension also keeps track of total tokens and API usage cost for the entire task loop and individual requests, keeping you informed of spend every step of the way.

<!-- Transparent pixel to create line break after floating image -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="left" width="370" src="https://github.com/user-attachments/assets/81be79a8-1fdb-4028-9129-5fe055e01e76">

### Run Commands in Terminal

Thanks to the new [shell integration updates in VSCode v1.93](https://code.visualstudio.com/updates/v1_93#_terminal-shell-integration-api), Cline can execute commands directly in your terminal and receive the output. This allows him to perform a wide range of tasks, from installing packages and running build scripts to deploying applications, managing databases, and executing tests, all while adapting to your dev environment & toolchain to get the job done right.

For long running processes like dev servers, use the "Proceed While Running" button to let Cline continue in the task while the command runs in the background. As Cline works he’ll be notified of any new terminal output along the way, letting him react to issues that may come up, such as compile-time errors when editing files.

<!-- Transparent pixel to create line break after floating image -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="right" width="400" src="https://github.com/user-attachments/assets/c5977833-d9b8-491e-90f9-05f9cd38c588">

### Create and Edit Files

Cline can create and edit files directly in your editor, presenting you a diff view of the changes. You can edit or revert Cline's changes directly in the diff view editor, or provide feedback in chat until you're satisfied with the result. Cline also monitors linter/compiler errors (missing imports, syntax errors, etc.) so he can fix issues that come up along the way on his own.

All changes made by Cline are recorded in your file's Timeline, providing an easy way to track and revert modifications if needed.

<!-- Transparent pixel to create line break after floating image -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="left" width="370" src="https://github.com/user-attachments/assets/bc2e85ba-dfeb-4fe6-9942-7cfc4703cbe5">

### Use the Browser

With Claude 3.5 Sonnet's new [Computer Use](https://www.anthropic.com/news/3-5-models-and-computer-use) capability, Cline can launch a browser, click elements, type text, and scroll, capturing screenshots and console logs at each step. This allows for interactive debugging, end-to-end testing, and even general web use! This gives him autonomy to fixing visual bugs and runtime issues without you needing to handhold and copy-pasting error logs yourself.

Try asking Cline to "test the app", and watch as he runs a command like `npm run dev`, launches your locally running dev server in a browser, and performs a series of tests to confirm that everything works. [See a demo here.](https://x.com/sdrzn/status/1850880547825823989)

<!-- Transparent pixel to create line break after floating image -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="right" width="350" src="https://github.com/user-attachments/assets/ac0efa14-5c1f-4c26-a42d-9d7c56f5fadd">

### "add a tool that..."

Thanks to the [Model Context Protocol](https://github.com/modelcontextprotocol), Cline can extend his capabilities through custom tools. While you can use [community-made servers](https://github.com/modelcontextprotocol/servers), Cline can instead create and install tools tailored to your specific workflow. Just ask Cline to "add a tool" and he will handle everything, from creating a new MCP server to installing it into the extension. These custom tools then become part of Cline's toolkit, ready to use in future tasks.

-   "add a tool that fetches Jira tickets": Retrieve ticket ACs and put Cline to work
-   "add a tool that manages AWS EC2s": Check server metrics and scale instances up or down
-   "add a tool that pulls the latest PagerDuty incidents": Fetch details and ask Cline to fix bugs

<!-- Transparent pixel to create line break after floating image -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="left" width="360" src="https://github.com/user-attachments/assets/7fdf41e6-281a-4b4b-ac19-020b838b6970">

### Add Context

**`@url`:** Paste in a URL for the extension to fetch and convert to markdown, useful when you want to give Cline the latest docs

**`@problems`:** Add workspace errors and warnings ('Problems' panel) for Cline to fix

**`@file`:** Adds a file's contents so you don't have to waste API requests approving read file (+ type to search files)

**`@folder`:** Adds folder's files all at once to speed up your workflow even more

## Contributing

To contribute to the project, start by exploring [open issues](https://github.com/cline/cline/issues) or checking our [feature request board](https://github.com/cline/cline/discussions/categories/feature-requests?discussions_q=is%3Aopen+category%3A%22Feature+Requests%22+sort%3Atop). We'd also love to have you join our [Discord](https://discord.gg/cline) to share ideas and connect with other contributors. If you're interested in joining the team, check out our [careers page](https://cline.bot/join-us)!

<details>
<summary>Local Development Instructions</summary>

1. Clone the repository _(Requires [git-lfs](https://git-lfs.com/))_:
    ```bash
    git clone https://github.com/cline/cline.git
    ```
2. Open the project in VSCode:
    ```bash
    code cline
    ```
3. Install the necessary dependencies for the extension and webview-gui:
    ```bash
    npm run install:all
    ```
4. Launch by pressing `F5` (or `Run`->`Start Debugging`) to open a new VSCode window with the extension loaded. (You may need to install the [esbuild problem matchers extension](https://marketplace.visualstudio.com/items?itemName=connor4312.esbuild-problem-matchers) if you run into issues building the project.)

</details>

## License

[Apache 2.0 © 2024 Cline Bot Inc.](./LICENSE)
