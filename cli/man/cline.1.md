---
title: CLINE
section: 1
header: User Commands
footer: Cline CLI 1.0
date: January 2025
---

# NAME

cline - orchestrate and interact with Cline AI coding agents

# SYNOPSIS

**cline** [*prompt*] [*options*]

**cline** *command* [*subcommand*] [*options*] [*arguments*]

# DESCRIPTION

Try: cat README.md | cline "Summarize this for me:"

**cline** is a command-line interface for orchestrating multiple Cline AI coding agents. Cline is an autonomous AI agent who can read, write, and execute code across your projects. He operates through a client-server architecture where **Cline Core** runs as a standalone service, and the CLI acts as a scriptable interface for managing tasks, instances, and agent interactions.

The CLI is designed for both interactive use and automation, making it ideal for CI/CD pipelines, parallel task execution, and terminal-based workflows. Multiple frontends (CLI, VSCode, JetBrains) can attach to the same Cline Core instance, enabling seamless task handoff between environments.

# MODES OF OPERATION

**Instant Task Mode**

:   The simplest invocation: **cline "prompt here"** immediately spawns an instance, creates a task, and enters chat mode. This is equivalent to running **cline instance new && cline task new && cline task chat** in sequence.

**Subcommand Mode**

:   Advanced usage with explicit control: **cline \<command\> [subcommand] [options]** provides fine-grained control over instances, tasks, authentication, and configuration.

# AGENT BEHAVIOR

Cline operates in two primary modes:

**ACT MODE**

:   Cline actively uses tools to accomplish tasks. He can read files, write code, execute commands, use a headless browser, and more. This is the default mode for task execution.

**PLAN MODE**

:   Cline gathers information and creates a detailed plan before implementation. He explores the codebase, asks clarifying questions, and presents a strategy for user approval before switching to ACT MODE.

# INSTANT TASK OPTIONS

When using the instant task syntax **cline "prompt"** the following options are available:

**-o**, **\--oneshot**

:   Full autonomous mode. Cline completes the task and stops following after completion. Example: cline -o "what's 6 + 8?"

**-s**, **\--setting** *setting* *value*

:   Override a setting for this task

**-y**, **\--no-interactive**, **\--yolo**

:   Enable fully autonomous mode. Disables all interactivity:
    - ask_followup_question tool is disabled
    - attempt_completion happens automatically
    - execute_command runs in non-blocking mode with timeout
    - PLAN MODE automatically switches to ACT MODE

**-m**, **\--mode** *mode*

:   Starting mode. Options: **act** (default), **plan**

# GLOBAL OPTIONS

These options apply to all subcommands:

**-F**, **\--output-format** *format*

:   Output format. Options: **rich** (default), **json**, **plain**

**-h**, **\--help**

:   Display help information for the command.

**-v**, **\--verbose**

:   Enable verbose output for debugging.

# COMMANDS

## Authentication

**cline auth** [*provider*] [*key*]

**cline a** [*provider*] [*key*]

:   Configure authentication for AI model providers. Launches an interactive wizard if no arguments provided. If provider is specified without a key, prompts for the key or launches the appropriate OAuth flow.

## Instance Management

Cline Core instances are independent agent processes that can run in the background. Multiple instances can run simultaneously, enabling parallel task execution.

**cline instance**

**cline i**

:   Display instance management help.

**cline instance new** [**-d**|**\--default**]

**cline i n** [**-d**|**\--default**]

:   Spawn a new Cline Core instance. Use **\--default** to set it as the default instance for subsequent commands.

**cline instance list**

**cline i l**

:   List all running Cline Core instances with their addresses and status.

**cline instance default** *address*

**cline i d** *address*

:   Set the default instance to avoid specifying **\--address** in task commands.

**cline instance kill** *address* [**-a**|**\--all**]

**cline i k** *address* [**-a**|**\--all**]

:   Terminate a Cline Core instance. Use **\--all** to kill all running instances.

## Task Management

Tasks represent individual work items that Cline executes. Tasks maintain conversation history, checkpoints, and settings.

**cline task** [**-a**|**\--address** *ADDR*]

**cline t** [**-a**|**\--address** *ADDR*]

:   Display task management help. The **\--address** flag specifies which Cline Core instance to use (e.g., localhost:50052).

**cline task new** *prompt* [*options*]

**cline t n** *prompt* [*options*]

:   Create a new task in the default or specified instance. Options:

    **-s**, **\--setting** *setting* *value*
    :   Set task-specific settings

    **-y**, **\--no-interactive**, **\--yolo**
    :   Enable autonomous mode

    **-m**, **\--mode** *mode*
    :   Starting mode (act or plan)

**cline task open** *task-id* [*options*]

**cline t o** *task-id* [*options*]

:   Resume a previous task from history. Accepts the same options as **task new**.

**cline task list**

**cline t l**

:   List all tasks in history with their id and snippet

**cline task chat**

**cline t c**

:   Enter interactive chat mode for the current task. Allows back-and-forth conversation with Cline.

**cline task send** [*message*] [*options*]

**cline t s** [*message*] [*options*]

:   Send a message to Cline. If no message is provided, reads from stdin. Options:

    **-a**, **\--approve**
    :   Approve Cline's proposed action

    **-d**, **\--deny**
    :   Deny Cline's proposed action

    **-f**, **\--file** *FILE*
    :   Attach a file to the message

    **-y**, **\--no-interactive**, **\--yolo**
    :   Enable autonomous mode

    **-m**, **\--mode** *mode*
    :   Switch mode (act or plan)

**cline task view** [**-f**|**\--follow**] [**-c**|**\--follow-complete**]

**cline t v** [**-f**|**\--follow**] [**-c**|**\--follow-complete**]

:   Display the current conversation. Use **\--follow** to stream updates in real-time, or **\--follow-complete** to follow until task completion.

**cline task restore** *checkpoint*

**cline t r** *checkpoint*

:   Restore the task to a previous checkpoint state.

**cline task pause**

**cline t p**

:   Pause task execution.

## Configuration

Configuration can be set globally. Override these global settings for a task using the **\--setting** flag

**cline config**

**cline c**

**cline config set** *key* *value*

**cline c s** *key* *value*

:   Set a configuration variable.

**cline config get** *key*

**cline c g** *key*

:   Read a configuration variable.

**cline config list**

**cline c l**

:   List all configuration variables and their values.

# TASK SETTINGS

Task settings are persisted in the *~/.cline/x/tasks* directory. When resuming a task with **cline task open**, task settings are automatically restored.

Common settings include:

**yolo**

:   Enable autonomous mode (true/false)

**mode**

:   Starting mode (act/plan)

# NOTES & EXAMPLES

The **cline task send** and **cline task new** commands support reading from stdin, enabling powerful pipeline compositions:

```bash
cat requirements.txt | cline task send
echo "Refactor this code" | cline -y
```

## Instance Management

Manage multiple Cline instances:

```bash
# Start a new instance and make it default
cline instance new --default

# List all running instances
cline instance list

# Kill a specific instance
cline instance kill localhost:50052

# Kill all CLI instances
cline instance kill --all-cli
```

## Task History

Work with task history:

```bash
# List previous tasks
cline task list

# Resume a previous task
cline task open 1760501486669

# View conversation history
cline task view

# Start interactive chat with this task
cline task chat
```

# ARCHITECTURE

Cline operates on a three-layer architecture:

**Presentation Layer**

:   User interfaces (CLI, VSCode, JetBrains) that connect to Cline Core via gRPC

**Cline Core**

:   The autonomous agent service handling task management, AI model integration, state management, tool orchestration, and real-time streaming updates

**Host Provider Layer**

:   Environment-specific integrations (VSCode APIs, JetBrains APIs, shell APIs) that Cline Core uses to interact with the host system

# BUGS

Report bugs at: <https://github.com/cline/cline/issues>

For real-time help, join the Discord community at: <https://discord.gg/cline>

# SEE ALSO

Full documentation: <https://docs.cline.bot>

# AUTHORS

Cline is developed by the Cline Bot Inc. and the open source community.

# COPYRIGHT

Copyright © 2025 Cline Bot Inc. Licensed under the Apache License 2.0.
