# Code Review Bot

An AI-powered code review agent that reads a git diff, analyzes it, and produces structured review comments with severity levels. Demonstrates custom tools, completion tools, and system prompts.

## Getting started

Install dependencies:

```bash
bun install
bun run build:sdk
```

Set an API key:

```bash
export CLINE_API_KEY="cline_..."
```

Review the last commit:

```bash
bun dev
```

Review against a specific ref:

```bash
bun dev main
bun dev HEAD~5
bun dev abc123
```

## What it does

1. Reads a `git diff` against the specified ref (defaults to `HEAD~1`)
2. Sends the diff to an agent with three custom tools:
   - `get_file_context` - reads full file contents for surrounding context
   - `add_review_comment` - records a review comment with file, line, severity, and message
   - `submit_review` - a completion tool that ends the run with a summary and approve/reject decision
3. Prints all comments grouped by severity (critical, warning, suggestion)

## Concepts demonstrated

- Multiple `createTool` definitions with zod schemas
- `lifecycle: { completesRun: true }` to make a tool end the agent loop
- Rich `systemPrompt` with structured instructions
- Event subscription filtered by tool name
- Processing structured results after the run completes

## Notes

For a simpler starting point, see [quickstart](../quickstart). For an interactive chat agent, see [cli-agent](../cli-agent).
