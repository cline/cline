<div align="center">
  <h2>Join the Roo Code Community</h2>
  <p>Connect with developers, contribute ideas, and stay ahead with the latest AI-powered coding tools.</p>
  
  <a href="https://discord.gg/roocode" target="_blank"><img src="https://img.shields.io/badge/Join%20Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Join Discord" height="60"></a>
  <a href="https://www.reddit.com/r/RooCode/" target="_blank"><img src="https://img.shields.io/badge/Join%20Reddit-FF4500?style=for-the-badge&logo=reddit&logoColor=white" alt="Join Reddit" height="60"></a>
  
</div>
<br>
<br>

<div align="center">
<h1>Roo Code (prev. Roo Cline)</h1>

<a href="https://marketplace.visualstudio.com/items?itemName=RooVeterinaryInc.roo-cline" target="_blank"><img src="https://img.shields.io/badge/Download%20on%20VS%20Marketplace-blue?style=for-the-badge&logo=visualstudiocode&logoColor=white" alt="Download on VS Marketplace"></a>
<a href="https://github.com/RooVetGit/Roo-Code/discussions/categories/feature-requests?discussions_q=is%3Aopen+category%3A%22Feature+Requests%22+sort%3Atop" target="_blank"><img src="https://img.shields.io/badge/Feature%20Requests-yellow?style=for-the-badge" alt="Feature Requests"></a>
<a href="https://marketplace.visualstudio.com/items?itemName=RooVeterinaryInc.roo-cline&ssr=false#review-details" target="_blank"><img src="https://img.shields.io/badge/Rate%20%26%20Review-green?style=for-the-badge" alt="Rate & Review"></a>
<a href="https://docs.roocode.com" target="_blank"><img src="https://img.shields.io/badge/Documentation-6B46C1?style=for-the-badge&logo=readthedocs&logoColor=white" alt="Documentation"></a>

</div>

**Roo Code** is an AI-powered **autonomous coding agent** that lives in your editor. It can:

- Communicate in natural language
- Read and write files directly in your workspace
- Run terminal commands
- Automate browser actions
- Integrate with any OpenAI-compatible or custom API/model
- Adapt its “personality” and capabilities through **Custom Modes**

Whether you’re seeking a flexible coding partner, a system architect, or specialized roles like a QA engineer or product manager, Roo Code can help you build software more efficiently.

Check out the [CHANGELOG](CHANGELOG.md) for detailed updates and fixes.

---

## New in 3.7: Claude 3.7 Sonnet Support 🚀

We're excited to announce support for Anthropic's latest model, Claude 3.7 Sonnet! The model shows notable improvements in:

- Front-end development and full-stack updates
- Agentic workflows for multi-step processes
- More accurate math, coding, and instruction-following

Try it today in your provider of choice!

---

## What Can Roo Code Do?

- 🚀 **Generate Code** from natural language descriptions
- 🔧 **Refactor & Debug** existing code
- 📝 **Write & Update** documentation
- 🤔 **Answer Questions** about your codebase
- 🔄 **Automate** repetitive tasks
- 🏗️ **Create** new files and projects

## Quick Start

1. [Install Roo Code](https://docs.roocode.com/getting-started/installing)
2. [Connect Your AI Provider](https://docs.roocode.com/getting-started/connecting-api-provider)
3. [Try Your First Task](https://docs.roocode.com/getting-started/your-first-task)

## Key Features

### Multiple Modes

Roo Code adapts to your needs with specialized [modes](https://docs.roocode.com/basic-usage/modes):

- **Code Mode:** For general-purpose coding tasks
- **Architect Mode:** For planning and technical leadership
- **Ask Mode:** For answering questions and providing information
- **Debug Mode:** For systematic problem diagnosis
- **[Custom Modes](https://docs.roocode.com/advanced-usage/custom-modes):** Create unlimited specialized personas for security auditing, performance optimization, documentation, or any other task

### Smart Tools

Roo Code comes with powerful [tools](https://docs.roocode.com/basic-usage/using-tools) that can:

- Read and write files in your project
- Execute commands in your VS Code terminal
- Control a web browser
- Use external tools via [MCP (Model Context Protocol)](https://docs.roocode.com/advanced-usage/mcp)

MCP extends Roo Code's capabilities by allowing you to add unlimited custom tools. Integrate with external APIs, connect to databases, or create specialized development tools - MCP provides the framework to expand Roo Code's functionality to meet your specific needs.

### Customization

Make Roo Code work your way with:

- [Custom Instructions](https://docs.roocode.com/advanced-usage/custom-instructions) for personalized behavior
- [Custom Modes](https://docs.roocode.com/advanced-usage/custom-modes) for specialized tasks
- [Local Models](https://docs.roocode.com/advanced-usage/local-models) for offline use
- [Auto-Approval Settings](https://docs.roocode.com/advanced-usage/auto-approving-actions) for faster workflows

## Resources

### Documentation

- [Basic Usage Guide](https://docs.roocode.com/basic-usage/the-chat-interface)
- [Advanced Features](https://docs.roocode.com/advanced-usage/auto-approving-actions)
- [Frequently Asked Questions](https://docs.roocode.com/faq)

### Community

- **Discord:** [Join our Discord server](https://discord.gg/roocode) for real-time help and discussions
- **Reddit:** [Visit our subreddit](https://www.reddit.com/r/RooCode) to share experiences and tips
- **GitHub:** Report [issues](https://github.com/RooVetGit/Roo-Code/issues) or request [features](https://github.com/RooVetGit/Roo-Code/discussions/categories/feature-requests?discussions_q=is%3Aopen+category%3A%22Feature+Requests%22+sort%3Atop)

---

## Local Setup & Development

1. **Clone** the repo:
    ```bash
    git clone https://github.com/RooVetGit/Roo-Code.git
    ```
2. **Install dependencies**:
    ```bash
    npm run install:all
    ```
3. **Build** the extension:
    ```bash
    npm run build
    ```
    - A `.vsix` file will appear in the `bin/` directory.
4. **Install** the `.vsix` manually if desired:
    ```bash
    code --install-extension bin/roo-code-4.0.0.vsix
    ```
5. **Start the webview (Vite/React app with HMR)**:
    ```bash
    npm run dev
    ```
6. **Debug**:
    - Press `F5` (or **Run** → **Start Debugging**) in VSCode to open a new session with Roo Code loaded.

Changes to the webview will appear immediately. Changes to the core extension will require a restart of the extension host.

We use [changesets](https://github.com/changesets/changesets) for versioning and publishing. Check our `CHANGELOG.md` for release notes.

---

## Disclaimer

**Please note** that Roo Veterinary, Inc does **not** make any representations or warranties regarding any code, models, or other tools provided or made available in connection with Roo Code, any associated third-party tools, or any resulting outputs. You assume **all risks** associated with the use of any such tools or outputs; such tools are provided on an **"AS IS"** and **"AS AVAILABLE"** basis. Such risks may include, without limitation, intellectual property infringement, cyber vulnerabilities or attacks, bias, inaccuracies, errors, defects, viruses, downtime, property loss or damage, and/or personal injury. You are solely responsible for your use of any such tools or outputs (including, without limitation, the legality, appropriateness, and results thereof).

---

## Contributing

We love community contributions! Here’s how to get involved:

1. **Check Issues & Requests**: See [open issues](https://github.com/RooVetGit/Roo-Code/issues) or [feature requests](https://github.com/RooVetGit/Roo-Code/discussions/categories/feature-requests).
2. **Fork & branch** off `main`.
3. **Submit a Pull Request** once your feature or fix is ready.
4. **Join** our [Reddit community](https://www.reddit.com/r/RooCode/) and [Discord](https://roocode.com/discord) for feedback, tips, and announcements.

---

## License

[Apache 2.0 © 2025 Roo Veterinary, Inc.](./LICENSE)

---

**Enjoy Roo Code!** Whether you keep it on a short leash or let it roam autonomously, we can’t wait to see what you build. If you have questions or feature ideas, drop by our [Reddit community](https://www.reddit.com/r/RooCode/) or [Discord](https://roocode.com/discord). Happy coding!
