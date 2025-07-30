<div align="center"><sub>
English | <a href="https://github.com/leuoson/ponder/blob/main/locales/es/README.md" target="_blank">Español</a> | <a href="https://github.com/leuoson/ponder/blob/main/locales/de/README.md" target="_blank">Deutsch</a> | <a href="https://github.com/leuoson/ponder/blob/main/locales/ja/README.md" target="_blank">日本語</a> | <a href="https://github.com/leuoson/ponder/blob/main/locales/zh-cn/README.md" target="_blank">简体中文</a> | <a href="https://github.com/leuoson/ponder/blob/main/locales/zh-tw/README.md" target="_blank">繁體中文</a> | <a href="https://github.com/leuoson/ponder/blob/main/locales/ko/README.md" target="_blank">한국어</a>
</sub></div>

# Ponder – AI-Powered Writing Assistant

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
<a href="https://github.com/leuoson/ponder" target="_blank"><strong>GitHub</strong></a>
</td>
<td align="center">
<a href="https://github.com/leuoson/ponder/discussions" target="_blank"><strong>Discussions</strong></a>
</td>
<td align="center">
<a href="https://github.com/leuoson/ponder/issues" target="_blank"><strong>Feature Requests</strong></a>
</td>
<td align="center">
<a href="#getting-started" target="_blank"><strong>Getting Started</strong></a>
</td>
</tbody>
</table>
</div>

Meet Ponder, an AI-powered writing assistant that transforms VS Code into your creative writing studio.

Forked from the powerful Cline project, Ponder redirects AI capabilities from software development to the realm of creative writing, content creation, and literary composition. Thanks to advanced language models like Claude 3.7 Sonnet, Ponder can assist with complex writing tasks including novel writing, poetry creation, screenplay development, academic writing, content marketing, and editorial work. With tools that let it create & edit documents, research topics, organize content structures, and even help with publishing workflows, Ponder provides comprehensive writing support that goes far beyond simple text generation. The extension maintains a human-in-the-loop approach, requiring your approval for every change, ensuring you remain in creative control while leveraging AI's capabilities to enhance your writing process.

1. **Start Your Creative Project**: Describe your writing goal - whether it's a novel, screenplay, blog post, or marketing copy. Add reference materials, style guides, or inspiration images to guide the creative process.
2. **Ponder Analyzes Your Context**: The assistant examines your existing documents, research materials, and writing style to understand your project's scope and requirements. It can work with large manuscripts and complex narrative structures without losing context.
3. **Comprehensive Writing Support**: Once Ponder understands your project, it can:
    - Create and edit documents with attention to narrative flow, character development, and stylistic consistency
    - Research topics and gather relevant information to enrich your content
    - Organize story structures, create outlines, and manage complex plot elements
    - Generate creative content while maintaining your unique voice and style
    - Provide editorial feedback and suggestions for improvement
4. **Review and Refine**: When a writing task is completed, Ponder presents the results for your review, allowing you to approve, modify, or request revisions to ensure the final output meets your creative vision.

> [!TIP]
> Use the `CMD/CTRL + Shift + P` shortcut to open the command palette and type "Ponder: Open In New Tab" to open the extension as a tab in your editor. This lets you use Ponder side-by-side with your file explorer, and see how it enhances your writing workspace.

---

<img align="right" width="340" src="https://github.com/user-attachments/assets/3cf21e04-7ce9-4d22-a7b9-ba2c595e88a4">

### Use any API and Model

Ponder supports API providers like OpenRouter, Anthropic, OpenAI, Google Gemini, AWS Bedrock, Azure, GCP Vertex, Cerebras and Groq. You can also configure any OpenAI compatible API, or use a local model through LM Studio/Ollama. If you're using OpenRouter, the extension fetches their latest model list, allowing you to use the newest models as soon as they're available.

The extension also keeps track of total tokens and API usage cost for the entire writing session and individual requests, keeping you informed of spend every step of the way.

<!-- Transparent pixel to create line break after floating image -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="left" width="370" src="https://github.com/user-attachments/assets/81be79a8-1fdb-4028-9129-5fe055e01e76">

### Execute Research Commands

Thanks to the new [shell integration updates in VSCode v1.93](https://code.visualstudio.com/updates/v1_93#_terminal-shell-integration-api), Ponder can execute commands directly in your terminal for research and content management tasks. This allows it to perform a wide range of writing-related activities, from installing writing tools and running text processing scripts to managing publishing workflows, organizing research materials, and executing content analysis tools, all while adapting to your writing environment & toolchain.

For long running processes like content generation or research gathering, use the "Proceed While Running" button to let Ponder continue working while the command runs in the background. As Ponder works, it'll be notified of any new output, letting it react to research findings or content updates that may come up during the writing process.

<!-- Transparent pixel to create line break after floating image -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="right" width="400" src="https://github.com/user-attachments/assets/c5977833-d9b8-491e-90f9-05f9cd38c588">

### Create and Edit Documents

Ponder can create and edit documents directly in your editor, presenting you a diff view of the changes. You can edit or revert Ponder's changes directly in the diff view editor, or provide feedback in chat until you're satisfied with the result. Ponder also monitors writing quality, consistency, and style issues so it can address problems that come up during the writing process.

All changes made by Ponder are recorded in your file's Timeline, providing an easy way to track and revert modifications if needed.

<!-- Transparent pixel to create line break after floating image -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="left" width="370" src="https://github.com/user-attachments/assets/bc2e85ba-dfeb-4fe6-9942-7cfc4703cbe5">

### Research and Web Browsing

With Claude 3.5 Sonnet's new [Computer Use](https://www.anthropic.com/news/3-5-models-and-computer-use) capability, Ponder can launch a browser, navigate websites, and gather research information, capturing screenshots and content at each step. This allows for comprehensive research, fact-checking, and content inspiration gathering! This gives Ponder autonomy in researching topics, verifying information, and finding relevant sources without you needing to manually copy-paste research materials.

Try asking Ponder to "research this topic", and watch as it opens a browser, searches for relevant information, and compiles research notes for your writing project. Perfect for academic writing, journalism, or any content that requires thorough research.

<!-- Transparent pixel to create line break after floating image -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="right" width="350" src="https://github.com/user-attachments/assets/ac0efa14-5c1f-4c26-a42d-9d7c56f5fadd">

### "add a writing tool that..."

Thanks to the [Model Context Protocol](https://github.com/modelcontextprotocol), Ponder can extend its capabilities through custom writing tools. While you can use [community-made servers](https://github.com/modelcontextprotocol/servers), Ponder can instead create and install tools tailored to your specific writing workflow. Just ask Ponder to "add a writing tool" and it will handle everything, from creating a new MCP server to installing it into the extension. These custom tools then become part of Ponder's writing toolkit, ready to use in future projects.

-   "add a tool that manages character databases": Keep track of characters, their traits, and relationships across your stories
-   "add a tool that analyzes writing style": Compare your writing against famous authors or maintain consistency across chapters
-   "add a tool that manages research notes": Organize and cross-reference research materials for non-fiction projects

<!-- Transparent pixel to create line break after floating image -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="left" width="360" src="https://github.com/user-attachments/assets/7fdf41e6-281a-4b4b-ac19-020b838b6970">

### Add Writing Context

**`@url`:** Paste in a URL for the extension to fetch and convert to markdown, useful when you want to give Ponder the latest research or reference materials

**`@problems`:** Add writing issues and style warnings for Ponder to address and improve

**`@file`:** Adds a document's contents so you don't have to waste API requests approving read operations (+ type to search documents)

**`@folder`:** Adds folder's documents all at once to speed up your writing workflow even more

<!-- Transparent pixel to create line break after floating image -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="right" width="350" src="https://github.com/user-attachments/assets/140c8606-d3bf-41b9-9a1f-4dbf0d4c90cb">

### Checkpoints: Compare and Restore

As Ponder works through a writing project, the extension takes a snapshot of your workspace at each step. You can use the 'Compare' button to see a diff between the snapshot and your current workspace, and the 'Restore' button to roll back to that point.

For example, when working on a novel, you can use 'Restore Workspace Only' to quickly test different plot directions or character developments, then use 'Restore Task and Workspace' when you find the version you want to continue building from. This lets you safely explore different creative approaches without losing progress.

<!-- Transparent pixel to create line break after floating image -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

## Getting Started

### Installation

1. Install Ponder from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=saoudrizwan.claude-dev)
2. Open the extension and configure your preferred AI model (Anthropic Claude, OpenAI, etc.)
3. Start your first writing project by describing what you want to create

### Writing Use Cases

- **Creative Writing**: Novels, short stories, poetry, screenplays
- **Content Marketing**: Blog posts, social media content, marketing copy
- **Academic Writing**: Research papers, essays, thesis work
- **Technical Writing**: Documentation, manuals, guides
- **Journalism**: Articles, interviews, investigative pieces
- **Business Writing**: Reports, proposals, presentations

## Contributing

To contribute to the project, start with our [Contributing Guide](CONTRIBUTING.md) to learn the basics. You can also join discussions in our [GitHub Discussions](https://github.com/leuoson/ponder/discussions) to chat with other writers and contributors.

## License

[Apache 2.0 © 2025 Ponder Project](./LICENSE)

---

*Ponder is a fork of [Cline](https://github.com/cline/cline), adapted specifically for creative writing and content creation workflows.*
