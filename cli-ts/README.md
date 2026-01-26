# Cline CLI (TypeScript)

A TypeScript CLI implementation of Cline that reuses the core TypeScript codebase. This allows you to run Cline tasks directly from the terminal while sharing the same underlying functionality as the VS Code extension.

## Features

- **Reuses Core Codebase**: Shares the same Controller, Task, and API handling as the VS Code extension
- **Terminal Output**: Displays Cline messages directly in your terminal with colored output
- **Task History**: Access your task history from the command line
- **Configurable**: Use custom configuration directories and working directories
- **Image Support**: Attach images to your prompts using file paths or inline references

## Prerequisites

- Node.js 20.x or later
- npm or yarn
- The parent Cline project dependencies installed

## Installation

From the repository root:

```bash
# Install all dependencies first
npm run install:all

# Ensure protos are generated
npm run protos

# Build the CLI
npm run build:cli
```

Or install the CLI globally:

```bash
# Install all dependencies first
npm run install:all

# Ensure protos are generated
npm run protos

# Build and link the CLI globally
cd cli-ts
npm install
npm run link
```

## Usage

### Interactive Mode (Default)

When you run `cline` without any command, it launches an interactive welcome prompt:

```bash
# Launch interactive mode
cline

# Or run a task directly
cline "Create a hello world function in Python"

# With options
cline -v --thinking "Analyze this codebase"
```

### Commands

#### `task` (alias: `t`)

Run a new task with a prompt.

```bash
cline task "Create a hello world function in Python"
cline t "Create a hello world function"
```

**Options:**

| Option | Description |
|--------|-------------|
| `-a, --act` | Run in act mode |
| `-p, --plan` | Run in plan mode |
| `-y, --yolo` | Enable yolo mode (auto-approve actions) |
| `-m, --model <model>` | Model to use for the task |
| `-i, --images <paths...>` | Image file paths to include with the task |
| `-v, --verbose` | Show verbose output including reasoning |
| `-c, --cwd <path>` | Working directory for the task |
| `--config <path>` | Path to Cline configuration directory |
| `-t, --thinking` | Enable extended thinking (1024 token budget) |

**Examples:**

```bash
# Run in plan mode with verbose output
cline task -p -v "Design a REST API"

# Use a specific model with yolo mode
cline task -m claude-sonnet-4-5-20250929 -y "Refactor this function"

# Include images with your prompt
cline task -i screenshot.png diagram.jpg "Fix the UI based on these images"

# Or use inline image references in the prompt
cline task "Fix the layout shown in @./screenshot.png"

# Enable extended thinking for complex tasks
cline task -t "Architect a microservices system"

# Specify working directory
cline task -c /path/to/project "Add unit tests"
```

#### `history` (alias: `h`)

List task history with pagination support.

```bash
cline history
cline h
```

**Options:**

| Option | Description |
|--------|-------------|
| `-n, --limit <number>` | Number of tasks to show (default: 10) |
| `-p, --page <number>` | Page number, 1-based (default: 1) |
| `--config <path>` | Path to Cline configuration directory |

**Examples:**

```bash
# Show last 10 tasks (default)
cline history

# Show 20 tasks
cline history -n 20

# Show page 2 with 5 tasks per page
cline history -n 5 -p 2
```

#### `config`

Show current configuration including global and workspace state.

```bash
cline config
```

**Options:**

| Option | Description |
|--------|-------------|
| `--config <path>` | Path to Cline configuration directory |

#### `auth`

Authenticate a provider and configure what model is used.

```bash
cline auth
```

**Options:**

| Option | Description |
|--------|-------------|
| `-p, --provider <id>` | Provider ID for quick setup (e.g., openai-native, anthropic) |
| `-k, --apikey <key>` | API key for the provider |
| `-m, --modelid <id>` | Model ID to configure (e.g., gpt-4o, claude-sonnet-4-5-20250929) |
| `-b, --baseurl <url>` | Base URL (optional, only for openai provider) |
| `-v, --verbose` | Show verbose output |
| `-c, --cwd <path>` | Working directory for the task |
| `--config <path>` | Path to Cline configuration directory |

**Examples:**

```bash
# Interactive authentication
cline auth

# Quick setup with provider and API key
cline auth -p anthropic -k sk-ant-xxxxx

# Full quick setup with model
cline auth -p openai-native -k sk-xxxxx -m gpt-4o

# OpenAI-compatible provider with custom base URL
cline auth -p openai -k your-api-key -b https://api.example.com/v1
```

### Global Options

These options are available for the default command (running a task directly):

| Option | Description |
|--------|-------------|
| `-v, --verbose` | Show verbose output |
| `-c, --cwd <path>` | Working directory |
| `--config <path>` | Configuration directory |
| `--thinking` | Enable extended thinking (1024 token budget) |

## Development

For active development, at the root of this repo:

1. **Initial setup:**
   ```bash
   npm run install:all
   npm run protos
   ```

2. **Make changes to cli-ts:**
   ```bash
   npm run cli:dev 
   # or
   cd cli-ts && npm run dev
   ```

3. **Test your changes:**
   ```bash
   cline [your-command] # In a new Terminal
   ```

4. **When done:**
   ```bash
   npm run cli:unlink
   ```

### Build

```bash
cd cli-ts

# Development build with source maps
npm run build

# Production build (minified)
npm run build:production
```

### Watch Mode

```bash
npm run watch
```

### Type Checking

```bash
npm run typecheck
```

## Architecture

The CLI reuses the core Cline TypeScript codebase:

- **Controller** (`@core/controller`): Manages task lifecycle and state
- **Task** (`@core/task`): Executes Cline tasks using the AI API
- **StateManager** (`@core/storage`): Handles persistent state storage

CLI-specific implementations:

- `cli-host-bridge.ts`: CLI implementations of host bridge services
- `cli-webview-provider.ts`: WebviewProvider that outputs to terminal
- `cli-comment-review.ts`: Comment review controller for terminal
- `vscode-context.ts`: Mock VSCode extension context
- `display.ts`: Terminal output formatting utilities

## Configuration

The CLI stores its data in `~/.cline/data/` by default:

- `globalState.json`: Global settings and state
- `secrets.json`: API keys and secrets
- `workspace/`: Workspace-specific state
- `tasks/`: Task history and conversation data

Override with the `--config` option or `CLINE_DIR` environment variable.

## Comparison with Go CLI

This TypeScript CLI differs from the Go CLI (`cli/` directory):

| Feature | Go CLI | TypeScript CLI |
|---------|--------|----------------|
| Language | Go | TypeScript |
| Core sharing | Uses gRPC to communicate | Direct imports |
| Startup time | Fast | Moderate |
| Dependencies | Standalone binary | Requires Node.js |
| Best for | Production deployment | Development, debugging |

Choose the TypeScript CLI when you need to debug or modify the core Cline logic. Choose the Go CLI for production deployment with faster startup.

## Troubleshooting

### Build Errors

If you encounter build errors, ensure you've:
1. Run `npm install` in the repository root
2. Run `npm run protos` to generate proto files
3. Have all peer dependencies installed

### Missing Dependencies

The CLI imports from the parent project. If you see import errors:
```bash
cd ..  # Go to repository root
npm install
npm run protos
```

### Permission Denied

Make the CLI executable:
```bash
chmod +x dist/cli.js
```
