# Beadsmith

<p align="center">
  <img src="./assets/icons/beadsmith-bot.svg" width="128" height="128" alt="Beadsmith Logo" />
</p>

<div align="center">
<table>
<tbody>
<td align="center">
<a href="https://github.com/CodeHalwell/beadsmith" target="_blank"><strong>GitHub Repository</strong></a>
</td>
<td align="center">
<a href="https://github.com/CodeHalwell/beadsmith/issues" target="_blank"><strong>Issues</strong></a>
</td>
<td align="center">
<a href="https://github.com/CodeHalwell/beadsmith/discussions" target="_blank"><strong>Discussions</strong></a>
</td>
</tbody>
</table>
</div>

Beadsmith is an AI-powered coding assistant VS Code extension, forked from [Cline](https://github.com/cline/cline).

Built on Claude's agentic coding capabilities, Beadsmith can handle complex software development tasks step-by-step. With tools that let it create & edit files, explore large projects, use the browser, and execute terminal commands (after you grant permission), it can assist you in ways that go beyond code completion or tech support.

## Features

### Use any API and Model

Beadsmith supports API providers like OpenRouter, Anthropic, OpenAI, Google Gemini, AWS Bedrock, Azure, GCP Vertex, Cerebras, and Groq. You can also configure any OpenAI compatible API, or use a local model through LM Studio/Ollama.

The extension tracks total tokens and API usage cost for the entire task loop and individual requests, keeping you informed of spend every step of the way.

### Run Commands in Terminal

Beadsmith can execute commands directly in your terminal and receive the output. This allows it to perform a wide range of tasks, from installing packages and running build scripts to deploying applications, managing databases, and executing tests.

For long running processes like dev servers, use the "Proceed While Running" button to let Beadsmith continue in the task while the command runs in the background.

### Create and Edit Files

Beadsmith can create and edit files directly in your editor, presenting you a diff view of the changes. You can edit or revert changes directly in the diff view editor, or provide feedback in chat until you're satisfied with the result.

All changes made by Beadsmith are recorded in your file's Timeline, providing an easy way to track and revert modifications if needed.

### Use the Browser

With Claude's Computer Use capability, Beadsmith can launch a browser, click elements, type text, and scroll, capturing screenshots and console logs at each step. This allows for interactive debugging, end-to-end testing, and even general web use.

### Model Context Protocol (MCP)

Beadsmith can extend its capabilities through custom tools using the [Model Context Protocol](https://github.com/modelcontextprotocol). Create and install tools tailored to your specific workflow.

### Add Context

- **`@url`:** Paste in a URL for the extension to fetch and convert to markdown
- **`@problems`:** Add workspace errors and warnings for Beadsmith to fix
- **`@file`:** Adds a file's contents to context
- **`@folder`:** Adds folder's files all at once

### Checkpoints: Compare and Restore

As Beadsmith works through a task, the extension takes a snapshot of your workspace at each step. You can use the 'Compare' button to see a diff between the snapshot and your current workspace, and the 'Restore' button to roll back to that point.

## Development

### Prerequisites

- Node.js (LTS version)
- VS Code

### Setup

```bash
# Install all dependencies
npm run install:all

# Generate Protocol Buffer files (required before first build)
npm run protos

# Development mode with watch
npm run dev

# Or press F5 in VS Code to launch the extension in debug mode
```

### Testing

```bash
# Run all tests
npm run test

# Unit tests only
npm run test:unit

# E2E tests
npm run test:e2e
```

### Code Quality

```bash
# Check for lint errors
npm run lint

# Auto-format code
npm run format:fix

# TypeScript type checking
npm run check-types
```

## Contributing

Contributions are welcome! Please read our contributing guidelines before submitting pull requests.

## Acknowledgments

Beadsmith is a fork of [Cline](https://github.com/cline/cline), an excellent AI coding assistant. We're grateful to the Cline team for their foundational work.

## License

[Apache 2.0](./LICENSE)
