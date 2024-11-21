# Cline CLI

A command-line interface for Cline, powered by Deno.

## Installation

1. Make sure you have [Deno](https://deno.land/) installed
2. Install the CLI globally:
   ```bash
   cd cli
   deno task install
   ```

If you get a PATH warning during installation, add Deno's bin directory to your PATH:
```bash
echo 'export PATH="$HOME/.deno/bin:$PATH"' >> ~/.bashrc  # or ~/.zshrc
source ~/.bashrc  # or ~/.zshrc
```

## Usage

```bash
cline <task> [options]
```

### Security Model

The CLI implements several security measures:

1. File Operations:
   - Read/write access limited to working directory (--allow-read=., --allow-write=.)
   - Prevents access to files outside the project

2. Command Execution:
   - Strict allowlist of safe commands:
     * npm (install, run, test, build)
     * git (status, add, commit, push, pull, clone, checkout, branch)
     * deno (run, test, fmt, lint, check, compile, bundle)
     * ls (-l, -a, -la, -lh)
     * cat, echo
   - Interactive prompts for non-allowlisted commands:
     * y - Run once
     * n - Cancel execution
     * always - Remember for session
   - Clear warnings and command details shown
   - Session-based memory for approved commands

3. Required Permissions:
   - --allow-read=. - Read files in working directory
   - --allow-write=. - Write files in working directory
   - --allow-run - Execute allowlisted commands
   - --allow-net - Make API calls
   - --allow-env - Access environment variables

### Options

- `-m, --model <model>` - LLM model to use (default: "anthropic/claude-3.5-sonnet")
- `-k, --key <key>` - OpenRouter API key (required, or set OPENROUTER_API_KEY env var)
- `-h, --help` - Display help for command

### Examples

Analyze code:
```bash
export OPENROUTER_API_KEY=sk-or-v1-...
cline "Analyze this codebase"
```

Create files:
```bash
cline "Create a React component"
```

Run allowed command:
```bash
cline "Run npm install"
```

Run non-allowlisted command (will prompt for decision):
```bash
cline "Run yarn install"
# Responds with:
# Warning: Command not in allowlist
# Command: yarn install
# Do you want to run this command? (y/n/always)
```

## Development

The CLI is built with Deno. Available tasks:

```bash
# Run in development mode
deno task dev "your task here"

# Install globally
deno task install

# Type check the code
deno task check
```

### Security Features

- File operations restricted to working directory
- Command execution controlled by allowlist
- Interactive prompts for unknown commands
- Session-based command approval
- Clear warnings and command details
- Permission validation at runtime
