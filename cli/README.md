# Cline CLI

```
/_____/\ /_/\      /_______/\/__/\ /__/\ /_____/\
\:::__\/ \:\ \     \__.::._\/\::\_\\  \ \\::::_\/_
 \:\ \  __\:\ \       \::\ \  \:. `-\  \ \\:\/___/\
  \:\ \/_/\\:\ \____  _\::\ \__\:. _    \ \\::___\/_
   \:\_\ \ \\:\/___/\/__\::\__/\\. \`-\  \ \\:\____/\
    \_____\/ \_____\/\________\/ \__\/ \__\/ \_____\/
```

Autonomous coding agent CLI - capable of creating/editing files, running commands, using the browser, and more.

## Installation

Install Cline globally using npm:

```bash
npm install -g cline
```

## Usage

```bash
cline
```

This will start the Cline CLI interface where you can interact with the autonomous coding agent.

## Features

-   **Autonomous Coding**: AI-powered code generation, editing, and refactoring
-   **File Operations**: Create, read, update, and delete files and directories
-   **Command Execution**: Run shell commands and scripts
-   **Browser Automation**: Interact with web pages and applications
-   **Multi-Model Support**: Works with Anthropic Claude, OpenAI GPT, and other AI models
-   **MCP Integration**: Extensible through Model Context Protocol servers
-   **Project Understanding**: Analyzes codebases to provide context-aware assistance

## Requirements

-   Node.js 18.0.0 or higher
-   Supported platforms: macOS, Linux. Windows soon
-   Supported architectures: x64, arm64

## Configuration

Cline can be configured through:

-   Environment variables
-   Configuration files
-   Command-line arguments

### Cline home directory (sandboxing)

The CLI stores settings, task history, logs, and other runtime files in a single directory.

Precedence (highest to lowest):

1. `--cline-dir <path>`
2. `CLINE_DIR` environment variable
3. Default: `~/.cline`

If you want to avoid accidentally creating a typo'd directory, use `--strict`.

Example (run multiple isolated instances with different settings/task history):

```bash
cline --cline-dir /tmp/cline-a "task for instance A"
cline --cline-dir /tmp/cline-b "task for instance B"

# Fail if the provided directory doesn't already exist
cline --strict --cline-dir /tmp/cline-a "use existing sandbox"

# Always run in a fresh new instance (useful for orchestration)
cline --new -o -F json "do the thing"
```

### Instance cleanup

By default, cleanup only removes stale/unhealthy instances from the registry:

```bash
cline instance cleanup
```

To also terminate *healthy but idle* instances (requires a recent core with `getInstanceUsage` support):

```bash
cline instance cleanup --kill-idle --idle 30m
```

See the [main documentation](https://cline.bot) for detailed configuration options.

## Links

-   **Website**: [https://cline.bot](https://cline.bot)
-   **Documentation**: [https://docs.cline.bot](https://docs.cline.bot)
-   **GitHub**: [https://github.com/cline/cline](https://github.com/cline/cline)
-   **VSCode Extension**: Available in the VSCode Marketplace
-   **JetBrains Extension**: Available in the JetBrains Marketplace

## License

Apache-2.0 - see [LICENSE](https://github.com/cline/cline/blob/main/LICENSE) for details.

## Support

-   Report issues: [GitHub Issues](https://github.com/cline/cline/issues)
-   Community: [GitHub Discussions](https://github.com/cline/cline/discussions)
-   Documentation: [docs.cline.bot](https://docs.cline.bot)
-   Cline CLI Architecture: [architecture.md](./architecture.md)
