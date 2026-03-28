# Cline CLI

The official CLI for Cline. Run Cline tasks directly from the terminal with the same underlying functionality as the VS Code extension.

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

# Build and link the CLI globally
npm run cli:link
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

### Quick Start

```bash
# 1. Install all dependencies (root, webview-ui, cli)
npm run install:all

# 2. Build and link globally so you can run `cline` from anywhere
npm run cli:link

# 3. Test it
cline --help
```

### Scripts

Run these from the repository root:

| Script | Description |
|--------|-------------|
| `npm run install:all` | Install deps for root, webview-ui, and cli |
| `npm run cli:build` | Generate protos and build CLI |
| `npm run cli:build:production` | Production build (minified) |
| `npm run cli:link` | Build and `npm link` so you can run `cline` from anywhere |
| `npm run cli:unlink` | Remove the global `cline` symlink |
| `npm run cli:dev` | Link + watch mode for development |
| `npm run cli:watch` | Watch mode only (no initial build) |
| `npm run cli:test` | Run CLI tests |

### Development Workflow

1. Run `npm run cli:dev` - this links the CLI globally and starts watch mode
2. Make changes to files in `cli/src/`
3. The build automatically rebuilds on save
4. Test your changes by running `cline` in another terminal
5. When done, run `npm run cli:unlink` to clean up

### Proto Generation

The CLI uses proto-generated types for message passing (same as the VS Code extension). If you modify any `.proto` files, run:

```bash
npm run protos
```

This generates TypeScript types in `src/generated/` that both the CLI and extension use.

## Publish

#### 1. Publish to npm
```bash
npm publish
```

#### 2. Update the Homebrew formula
```bash
npm run update-brew-formula
```

#### 3. Test the formula locally
```bash
# Create a local tap
brew tap-new cline/local
cp ./cli/cline.rb "$(brew --repository)/Library/Taps/cline/homebrew-local/Formula/cline.rb"

# Build from Source
brew install --build-from-source cline/local/cline

# Install from your local tap
brew install cline/local/cline

# Clean up when done
brew untap cline/local
```

#### 4. If using a tap, commit and push
```bash
git add cline.rb
git commit -m "Update cline to v2.0.0"
git push
```

## Architecture

### How It Works

The CLI directly imports and reuses the core Cline TypeScript codebase (the same code that powers the VS Code extension). This means feature parity is easy to maintain - when core gets updated, the CLI automatically benefits.

```
┌─────────────────────────────────────────────────────────┐
│                     CLI (cli/)                          │
│  - React Ink terminal UI                                │
│  - Command parsing (commander)                          │
│  - Terminal-specific adapters                           │
└─────────────────────────────────────────────────────────┘
                          │
                          │ direct imports
                          ▼
┌─────────────────────────────────────────────────────────┐
│                  Core (src/core/)                       │
│  - Controller: task lifecycle, state management         │
│  - Task: AI API calls, tool execution                   │
│  - StateManager: persistent storage                     │
│  - Proto types: message definitions                     │
└─────────────────────────────────────────────────────────┘
```

Unlike a client-server architecture, the CLI runs everything in a single Node.js process. The "host bridge" pattern provides terminal-appropriate implementations for things the VS Code extension would handle differently (clipboard, file dialogs, etc.).

### Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Entry point, command definitions |
| `src/components/App.tsx` | Main React Ink app |
| `src/components/ChatView.tsx` | Task conversation UI |
| `src/controllers/CliWebviewProvider.ts` | Bridges core messages to terminal output |
| `src/vscode-context.ts` | Mock VS Code extension context for core compatibility |
| `src/vscode-shim.ts` | Shims for VS Code APIs that core depends on |
| `src/constants/colors.ts` | Terminal color definitions |

### React Ink

The CLI uses [React Ink](https://github.com/vadimdemedes/ink) for its terminal UI. This lets us build the interface with React components that render to the terminal. Key patterns:

- Components in `src/components/` render terminal UI
- Hooks in `src/hooks/` manage terminal-specific state (size, scrolling)
- The `useStateSubscriber` hook subscribes to core state changes

## Configuration

The CLI stores its data in `~/.cline/data/` by default:

- `globalState.json`: Global settings and state
- `secrets.json`: API keys and secrets
- `workspace/`: Workspace-specific state
- `tasks/`: Task history and conversation data

Override with the `--config` option or `CLINE_DIR` environment variable.

## Troubleshooting

### Build Errors

If you encounter build errors:

```bash
# Make sure all deps are installed
npm run install:all

# Regenerate proto types
npm run protos

# Then rebuild
npm run cli:build
```

### "command not found: cline"

The CLI isn't linked globally. Run:

```bash
npm run cli:link
```

### Changes Not Reflected

If your code changes aren't showing up:

1. Make sure watch mode is running (`npm run cli:dev`)
2. Check for TypeScript errors in the watch output
3. Try unlinking and relinking: `npm run cli:unlink && npm run cli:link`

### Import Errors from Core

The CLI imports from `@core/`, `@shared/`, etc. These paths are defined in the root `tsconfig.json`. If you see import errors, make sure you're building from the repo root, not from inside `cli/`.