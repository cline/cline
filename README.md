# Roo Code (prev. Roo Cline)

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

## New in 3.3: Code Actions, More Powerful Modes, and a new Discord! 🚀

This release brings significant improvements to how you interact with Roo Code:

### Code Actions

Roo Code now integrates directly with VS Code's native code actions system, providing quick fixes and refactoring options right in your editor. Look for the lightbulb 💡 to access Roo Code's capabilities without switching context.

### Enhanced Mode Capabilities

- **Markdown Editing**: Addressing one of the most requested features, Ask and Architect modes can now create and edit markdown files!
- **Custom File Restrictions**: In general, custom modes can now be restricted to specific file patterns (for example, a technical writer who can only edit markdown files 👋). There's no UI for this yet, but who needs that when you can just ask Roo to set it up for you?
- **Self-Initiated Mode Switching**: Modes can intelligently request to switch between each other based on the task at hand. For instance, Code mode might request to switch to Test Engineer mode once it's ready to write tests.

### Join Our Discord!

We've launched a new Discord community! Join us at [https://roocode.com/discord](https://roocode.com/discord) to:

- Share your custom modes
- Get help and support
- Connect with other Roo Code users
- Stay updated on the latest features

## New in 3.2: Introducing Custom Modes, plus rebranding from Roo Cline → Roo Code! 🚀

### Introducing Roo Code

Our biggest update yet is here - we're officially changing our name from Roo Cline to Roo Code! After growing beyond 50,000 installations across VS Marketplace and Open VSX, we're ready to chart our own course. Our heartfelt thanks to everyone in the Cline community who helped us reach this milestone.

### Custom Modes

To mark this new chapter, we're introducing the power to shape Roo Code into any role you need. You can now create an entire team of agents with deeply customized prompts:

- QA Engineers who write thorough test cases and catch edge cases
- Product Managers who excel at user stories and feature prioritization
- UI/UX Designers who craft beautiful, accessible interfaces
- Code Reviewers who ensure quality and maintainability

The best part is that Roo can help you create these new modes! Just type "Create a new mode for <X>" in the chat to get started, and go into the Prompts tab or (carefully) edit the JSON representation to customize the prompt and allowed tools to your liking.

We can't wait to hear more about what you build and how we can continue to evolve the Roo Code platform to support you. Please join us in our new https://www.reddit.com/r/RooCode subreddit to share your custom modes and be part of our next chapter. 🚀

## New in 3.1: Chat Mode Prompt Customization & Prompt Enhancements

Hot off the heels of **v3.0** introducing Code, Architect, and Ask chat modes, one of the most requested features has arrived: **customizable prompts for each mode**! 🎉

You can now tailor the **role definition** and **custom instructions** for every chat mode to perfectly fit your workflow. Want to adjust Architect mode to focus more on system scalability? Or tweak Ask mode for deeper research queries? Done. Plus, you can define these via **mode-specific `.clinerules-[mode]` files**. You’ll find all of this in the new **Prompts** tab in the top menu.

The second big feature in this release is a complete revamp of **prompt enhancements**. This feature helps you craft messages to get even better results from Cline. Here’s what’s new:

- Works with **any provider** and API configuration, not just OpenRouter.
- Fully customizable prompts to match your unique needs.
- Same simple workflow: just hit the ✨ **Enhance Prompt** button in the chat input to try it out.

Whether you’re using GPT-4, other APIs, or switching configurations, this gives you total control over how your prompts are optimized.

As always, we’d love to hear your thoughts and ideas! What features do you want to see in **v3.2**? Drop by https://www.reddit.com/r/roocline and join the discussion - we're building Roo Cline together. 🚀

## New in 3.0 - Chat Modes!

You can now choose between different prompts for Roo Cline to better suit your workflow. Here’s what’s available:

- **Code:** (existing behavior) The default mode where Cline helps you write code and execute tasks.

- **Architect:** "You are Cline, a software architecture expert..." Ideal for thinking through high-level technical design and system architecture. Can’t write code or run commands.

- **Ask:** "You are Cline, a knowledgeable technical assistant..." Perfect for asking questions about the codebase or digging into concepts. Also can’t write code or run commands.

**Switching Modes:**
It’s super simple! There’s a dropdown in the bottom left of the chat input to switch modes. Right next to it, you’ll find a way to switch between the API configuration profiles associated with the current mode (configured on the settings screen).

**Why Add This?**

- It keeps Cline from being overly eager to jump into solving problems when you just want to think or ask questions.
- Each mode remembers the API configuration you last used with it. For example, you can use more thoughtful models like OpenAI o1 for Architect and Ask, while sticking with Sonnet or DeepSeek for coding tasks.
- It builds on research suggesting better results when separating "thinking" from "coding," explained well in this very thoughtful [article](https://aider.chat/2024/09/26/architect.html) from aider.

Right now, switching modes is a manual process. In the future, we’d love to give Cline the ability to suggest mode switches based on context. For now, we’d really appreciate your feedback on this feature.

---

## Key Features

### Adaptive Autonomy

Roo Code communicates in **natural language** and proposes actions—file edits, terminal commands, browser tests, etc. You choose how it behaves:

- **Manual Approval**: Review and approve every step to keep total control.
- **Autonomous/Auto-Approve**: Grant Roo Code the ability to run tasks without interruption, speeding up routine workflows.
- **Hybrid**: Auto-approve specific actions (e.g., file writes) but require confirmation for riskier tasks (like deploying code).

No matter your preference, you always have the final say on what Roo Code does.

---

### Supports Any API or Model

Use Roo Code with:

- **OpenRouter**, Anthropic, Glama, OpenAI, Google Gemini, AWS Bedrock, Azure, GCP Vertex, or local models (LM Studio/Ollama)—anything **OpenAI-compatible**.
- Different models per mode. For instance, an advanced model for architecture vs. a cheaper model for daily coding tasks.
- **Usage Tracking**: Roo Code monitors token and cost usage for each session.

---

### Custom Modes

**Custom Modes** let you shape Roo Code’s persona, instructions, and permissions:

- **Built-in**:
    - **Code** – Default, multi-purpose coding assistant
    - **Architect** – High-level system and design insights
    - **Ask** – Research and Q&A for deeper exploration
- **User-Created**: Type `Create a new mode for <X>` and Roo Code generates a brand-new persona for that role—complete with tailored prompts and optional tool restrictions.

Modes can each have unique instructions and skill sets. Manage them in the **Prompts** tab.

**Advanced Mode Features:**

- **File Restrictions**: Modes can be restricted to specific file types (e.g., Ask and Architect modes can edit markdown files)
- **Custom File Rules**: Define your own file access patterns (e.g., `.test.ts` for test files only)
- **Direct Mode Switching**: Modes can request to switch to other modes when needed (e.g., switching to Code mode for implementation)
- **Self-Creation**: Roo Code can help create new modes, complete with role definitions and file restrictions

---

### File & Editor Operations

Roo Code can:

- **Create and edit** files in your project (showing you diffs).
- **React** to linting or compile-time errors automatically (missing imports, syntax errors, etc.).
- **Track changes** via your editor’s timeline so you can review or revert if needed.

---

### Command Line Integration

Easily run commands in your terminal—Roo Code:

- Installs packages, runs builds, or executes tests.
- Monitors output and adapts if it detects errors.
- Lets you keep dev servers running in the background while continuing to work.

You approve or decline each command, or set auto-approval for routine operations.

---

### Browser Automation

Roo Code can also open a **browser** session to:

- Launch your local or remote web app.
- Click, type, scroll, and capture screenshots.
- Collect console logs to debug runtime or UI/UX issues.

Ideal for **end-to-end testing** or visually verifying changes without constant copy-pasting.

---

### Adding Tools with MCP

Extend Roo Code with the **Model Context Protocol (MCP)**:

- “Add a tool that manages AWS EC2 resources.”
- “Add a tool that queries the company Jira.”
- “Add a tool that pulls the latest PagerDuty incidents.”

Roo Code can build and configure new tools autonomously (with your approval) to expand its capabilities instantly.

---

### Context Mentions

When you need to provide extra context:

- **@file** – Embed a file’s contents in the conversation.
- **@folder** – Include entire folder structures.
- **@problems** – Pull in workspace errors/warnings for Roo Code to fix.
- **@url** – Fetch docs from a URL, converting them to markdown.
- **@git** – Supply a list of Git commits or diffs for Roo Code to analyze code history.

Help Roo Code focus on the most relevant details without blowing the token budget.

---

## Installation

Roo Code is available on:

- **[VSCode Marketplace](https://marketplace.visualstudio.com/items?itemName=RooVeterinaryInc.roo-cline)**
- **[Open-VSX](https://open-vsx.org/extension/RooVeterinaryInc/roo-cline)**

1. **Search “Roo Code”** in your editor’s Extensions panel to install directly.
2. Or grab the `.vsix` file from Marketplace / Open-VSX and **drag-and-drop** into your editor.
3. **Open** Roo Code from the Activity Bar or Command Palette to start chatting.

> **Tip**: Use `Cmd/Ctrl + Shift + P` → “Roo Code: Open in New Tab” to dock the AI assistant alongside your file explorer.

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
5. **Debug**:
    - Press `F5` (or **Run** → **Start Debugging**) in VSCode to open a new session with Roo Code loaded.

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
