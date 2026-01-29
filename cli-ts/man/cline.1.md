---
title: CLINE
section: 1
header: User Commands
footer: Cline CLI 2.0
date: January 2026
---

# NAME

cline - AI coding assistant in your terminal

# SYNOPSIS

**cline** [*prompt*] [*options*]

**cline** *command* [*options*] [*arguments*]

# DESCRIPTION

**cline** is a command-line interface for the Cline AI coding assistant. It provides the same powerful AI capabilities as the VS Code extension, directly in your terminal.

Cline is an autonomous AI agent that can read, write, and execute code across your projects. He can create and edit files, run terminal commands, use a headless browser, and more—all while asking for your approval before taking actions.

The CLI supports both interactive mode (with a rich terminal UI) and plain text mode (for piped input and scripted workflows).

# MODES OF OPERATION

**Interactive Mode** :   When you run **cline** without arguments, it launches an interactive welcome prompt with a rich terminal UI. You can type your task, view conversation history, and interact with Cline in real-time.

**Task Mode** :   Run **cline "prompt"** or **cline task "prompt"** to immediately start a task. If stdin is a TTY, you'll see the interactive UI. If stdin is piped or output is redirected, the CLI automatically switches to plain text mode.

**Plain Text Mode** :   Activated automatically when stdin is piped, output is redirected, or **\--json**/**\--yolo** flags are used. Outputs clean text without the Ink UI, suitable for scripting and CI/CD pipelines.

# AGENT BEHAVIOR

Cline operates in two primary modes:

**ACT MODE** :   Cline actively uses tools to accomplish tasks. He can read files, write code, execute commands, use a headless browser, and more. This is the default mode for task execution.

**PLAN MODE** :   Cline gathers information and creates a detailed plan before implementation. He explores the codebase, asks clarifying questions, and presents a strategy for user approval before switching to ACT MODE.

# COMMANDS

## task (alias: t)

Run a new task with a prompt.

**cline task** *prompt* [*options*]

**cline t** *prompt* [*options*] :   Create and run a new task. Options:

**-a**, **\--act** :   Run in act mode (default)

**-p**, **\--plan** :   Run in plan mode

**-y**, **\--yolo** :   Enable yolo/yes mode (auto-approve all actions, output in plain mode, exit process automatically when task complete)

**-m**, **\--model** *model* :   Model to use for the task

**-i**, **\--images** *paths...* :   Image file paths to include with the task

**-v**, **\--verbose** :   Show verbose output including reasoning

**-c**, **\--cwd** *path* :   Working directory for the task

**\--config** *path* :   Path to Cline configuration directory

**\--thinking** :   Enable extended thinking (1024 token budget)

**\--json** :   Output messages as JSON instead of styled text

## history (alias: h)

List task history with pagination.

**cline history** [*options*]

**cline h** [*options*] :   Display previous tasks. Options:

**-n**, **\--limit** *number* :   Number of tasks to show (default: 10)

**-p**, **\--page** *number* :   Page number, 1-based (default: 1)

**\--config** *path* :   Path to Cline configuration directory

## config

Show current configuration.

**cline config** [*options*] :   Display global and workspace state. Options:

**\--config** *path* :   Path to Cline configuration directory

## auth

Authenticate a provider and configure the model.

**cline auth** [*options*] :   Launch interactive authentication wizard, or use quick setup flags. Options:

**-p**, **\--provider** *id* :   Provider ID for quick setup (e.g., openai-native, anthropic, openrouter)

**-k**, **\--apikey** *key* :   API key for the provider

**-m**, **\--modelid** *id* :   Model ID to configure (e.g., gpt-4o, claude-sonnet-4-5-20250929)

**-b**, **\--baseurl** *url* :   Base URL (optional, for OpenAI-compatible providers)

**-v**, **\--verbose** :   Show verbose output

**-c**, **\--cwd** *path* :   Working directory

**\--config** *path* :   Path to Cline configuration directory

## update

Check for updates and install if available.

**cline update** [*options*] :   Check npm for newer versions. Options:

**-v**, **\--verbose** :   Show verbose output

## version

Show the CLI version number.

**cline version**

## dev

Developer tools and utilities.

**cline dev log** :   Open the log file for debugging.

# DEFAULT COMMAND OPTIONS

When running **cline** with just a prompt (no subcommand), these options are available:

**-a**, **\--act** :   Run in act mode (default)

**-p**, **\--plan** :   Run in plan mode

**-y**, **\--yolo** :   Enable yolo mode (auto-approve all actions). Also forces plain text output mode.

**-m**, **\--model** *model* :   Model to use for the task

**-v**, **\--verbose** :   Show verbose output

**-c**, **\--cwd** *path* :   Working directory

**\--config** *path* :   Configuration directory

**\--thinking** :   Enable extended thinking (1024 token budget)

**\--json** :   Output messages as JSON instead of styled text. Forces plain text mode.

# JSON OUTPUT FORMAT

When using **\--json**, each message is output as a JSON object with these fields:

**Required fields:**

- **type**: "ask" or "say"
- **text**: message text
- **ts**: Unix epoch timestamp in milliseconds

**Optional fields:**

- **reasoning**: reasoning text
- **say**: say subtype (when type is "say")
- **ask**: ask subtype (when type is "ask")
- **partial**: streaming flag
- **images**: list of image URIs
- **files**: list of file paths

# EXAMPLES

## Basic Usage

```bash
# Launch interactive mode
cline

# Run a task directly
cline "Create a hello world function in Python"

# Run with verbose output and extended thinking
cline -v --thinking "Analyze this codebase architecture"
```

## Mode Selection

```bash
# Run in plan mode (gather info before acting)
cline -p "Design a REST API for user management"

# Run in act mode with auto-approval (yolo)
cline -y "Fix the typo in README.md"
```

## Using Specific Models

```bash
# Use a specific model
cline -m claude-sonnet-4-5-20250929 "Refactor this function"

# Quick auth setup with model
cline auth -p anthropic -k sk-ant-xxxxx -m claude-sonnet-4-5-20250929
```

## Including Images

```bash
# Include images with explicit flag
cline task -i screenshot.png diagram.jpg "Fix the UI based on these images"

# Or use inline image references in the prompt
cline "Fix the layout shown in @./screenshot.png"
```

## Piped Input

```bash
# Pipe file contents to Cline
cat README.md | cline "Summarize this document"

# Pipe with additional prompt
echo "function add(a, b) { return a + b }" | cline "Add TypeScript types to this"

# Combine piped input with a prompt
git diff | cline "Review these changes and suggest improvements"
```

## Scripting and Automation

```bash
# JSON output for parsing
cline --json "What files are in this directory?" | jq '.text'

# Yolo mode for automated workflows (auto-approves all actions), forces plain text output
cline -y "Run the test suite and fix any failures"
```

## Task History

```bash
# List recent tasks
cline history

# Show more tasks with pagination
cline history -n 20 -p 2
```

## Authentication

```bash
# Interactive authentication wizard
cline auth

# Quick setup for Anthropic
cline auth -p anthropic -k sk-ant-api-xxxxx

# Quick setup for OpenAI
cline auth -p openai-native -k sk-xxxxx -m gpt-4o

# OpenAI-compatible provider with custom base URL
cline auth -p openai -k your-api-key -b https://api.example.com/v1
```

# ENVIRONMENT

**CLINE_DIR** :   Override the default configuration directory. When set, Cline stores all data in this directory instead of `~/.cline/data/`.

**CLINE_COMMAND_PERMISSIONS** :   JSON configuration for restricting which shell commands Cline can execute. When set, commands are validated against allow/deny patternks before execution. When not set, all commands are allowed.

Format: `{"allow": ["pattern1", "pattern2"], "deny": ["pattern3"], "allowRedirects": true}`

**Fields:**

- **allow** (array of strings): Glob patterns for allowed commands. If specified, only matching commands are permitted. Uses `*` to match any characters and `?` to match a single character. Setting allow on anything will deny all others.
- **deny** (array of strings): Glob patterns for denied commands. Deny rules take precedence over allow rules.
- **allowRedirects** (boolean): Whether to allow shell redirects (`>`, `>>`, `<`, etc.). Defaults to false.

**Rule evaluation:**

1. Check for dangerous characters (backticks outside single quotes, unquoted newlines)
2. Parse command into segments split by operators (`&&`, `||`, `|`, `;`)
3. If redirects detected and `allowRedirects` is not true, command is denied
4. Each segment is validated against deny rules first, then allow rules
5. Subshell contents (`$(...)` and `(...)`) are recursively validated
6. All segments must pass for the command to be allowed

**Examples:**

```bash
# Allow only npm and git commands.
export CLINE_COMMAND_PERMISSIONS='{"allow": ["npm *", "git *"]}'

# Allow development commands but deny dangerous ones. Deny not strictly required here since allow is set.
export CLINE_COMMAND_PERMISSIONS='{"allow": ["npm *", "git *", "node *"], "deny": ["rm -rf *", "sudo *"]}'

# Allow file operations with redirects
export CLINE_COMMAND_PERMISSIONS='{"allow": ["cat *", "echo *"], "allowRedirects": true}'
```


# CONFIGURATION FILES

```
~/.cline/
├── data/                    # Default configuration directory
│   ├── globalState.json     # Global settings and state
│   ├── secrets.json         # API keys and secrets (stored securely)
│   ├── workspace/           # Workspace-specific state
│   └── tasks/               # Task history and conversation data
└── log/                     # Log files for debugging
```

View logs with `cline dev log`.


# BUGS

Report bugs at: <https://github.com/cline/cline/issues>

For real-time help, join the Discord community at: <https://discord.gg/cline>

# SEE ALSO

Full documentation: <https://docs.cline.bot>

VS Code extension: <https://marketplace.visualstudio.com/items?itemName=saoudrizwan.claude-dev>

# AUTHORS

Cline is developed by Cline Bot Inc. and the open source community.

# COPYRIGHT

Copyright © 2025 Cline Bot Inc. Licensed under the Apache License 2.0.
