# Cline CLI (TypeScript)

A TypeScript CLI implementation of Cline that reuses the core TypeScript codebase. This allows you to run Cline tasks directly from the terminal while sharing the same underlying functionality as the VS Code extension.

## Features

- **Reuses Core Codebase**: Shares the same Controller, Task, and API handling as the VS Code extension
- **Terminal Output**: Displays Cline messages directly in your terminal with colored output
- **Task History**: Access your task history from the command line
- **Configurable**: Use custom configuration directories and working directories

## Prerequisites

- Node.js 20.x or later
- npm or yarn
- The parent Cline project dependencies installed

## Installation

From the repository root:

```bash
# Install root dependencies first
npm install

# Build the CLI
npm run compile-cli-ts
```

Or install the CLI globally:

```bash
cd cli-ts
npm install
npm run build
npm link
```

## Usage

### Run a Task

```bash
# Run a task with a prompt
cline-ts task "Create a hello world function in Python"

# Or use the shorthand
cline-ts t "Create a hello world function"

# Run directly without the 'task' command
cline-ts "Create a hello world function"
```

### Options

```bash
# Show verbose output (including reasoning)
cline-ts task -v "Your prompt"

# Specify working directory
cline-ts task -c /path/to/project "Your prompt"

# Use custom config directory
cline-ts task --config ~/.my-cline "Your prompt"
```

### View Task History

```bash
# List recent tasks
cline-ts history

# Show more tasks
cline-ts history -n 20
```

### Show Configuration

```bash
cline-ts config
```

## Development

### Build

```bash
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
- `cli-diff-provider.ts`: DiffViewProvider for terminal diff display
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
