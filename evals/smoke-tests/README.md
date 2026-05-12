# Smoke Tests

Curated smoke tests that verify Cline works correctly with LLM providers.

## Purpose

These tests catch regressions in:
- Tool execution (read, write, edit files)
- Provider response parsing
- Tool chaining (multiple operations)
- Basic code generation

## Quick Start

```bash
# One-time auth setup
cline auth

# Build CLI from source (after code changes)
npm run eval:smoke:build

# Run tests (3 trials by default)
npm run eval:smoke:run

# Or build + run in one command
npm run eval:smoke
```

## Commands

| Command | What it does |
|---------|--------------|
| `npm run eval:smoke:build` | Build/install CLI from source |
| `npm run eval:smoke:run` | Run tests (uses installed CLI) |
| `npm run eval:smoke` | Build + run (3 trials) |
| `npm run eval:smoke:ci` | Build + run (1 trial, for CI) |

## Options

```bash
# Run specific scenario
npm run eval:smoke:run -- --scenario 01-create-file

# Run with fewer trials (faster)
npm run eval:smoke:run -- --trials 1

# Run with specific model (overrides any per-scenario models)
npm run eval:smoke:run -- --model claude-sonnet-4-5-20250929
```

## Authentication

### Interactive (recommended for local dev)

```bash
cline auth
```

### With API key (for automation)

```bash
cline auth -p cline -k "$CLINE_API_KEY" -m anthropic/claude-sonnet-4.5
```

## Scenarios

| ID | Name | What it tests |
|----|------|---------------|
| 01-create-file | Create a simple file | `write_to_file` |
| 02-edit-file | Edit existing file | `replace_in_file` |
| 03-read-summarize | Read and summarize | `read_file` |
| 04-multi-file | Create multiple files | Multiple tool calls |
| 05-typescript-function | Generate TypeScript | Code generation |
| 06-apply-patch | Edit file (GPT-5) | `apply_patch` tool, native tool calling |
| 07-edit-gemini | Edit file (Gemini) | Gemini model variant |

### Per-Scenario Models

Scenarios can specify their own model(s) via the `models` field in `config.json`. This is useful for testing model-specific code paths like `apply_patch` (GPT-5 only).

If you pass `--model`, it overrides any per-scenario `models` list.

Examples:
```bash
# Run apply_patch scenario with its default model (GPT-5)
npm run eval:smoke:run -- --scenario 06-apply-patch

# Force that scenario to use a specific model
npm run eval:smoke:run -- --scenario 06-apply-patch --model openai/gpt-4o
```

## Metrics

- **pass@k**: Probability at least 1 of k trials succeeds
- **pass^k**: Probability ALL k trials succeed (reliability)

Shows `pass@1` when trials < 3, `pass@3` otherwise.

## Adding New Scenarios

1. Create directory: `scenarios/<name>/`
2. Add `config.json`:
   ```json
   {
     "name": "Human-readable name",
     "description": "What this tests",
     "prompt": "The task prompt for Cline",
     "expectedFiles": ["file1.txt"],
     "expectedContent": [
       { "file": "file1.txt", "contains": "expected text" }
     ],
     "timeout": 60
   }
   ```
3. (Optional) Add `template/` directory with starting files

## CI Integration

Smoke tests run automatically via `.github/workflows/cline-evals-regression.yml`.

### Triggers

- Push to `main` (when core code changes)
- Pull requests
- Manual dispatch

### Architecture

```
Build Job (1x)          Test Jobs (5x parallel)       Summarize
─────────────────       ─────────────────────────     ──────────
compile-cli             Download artifact             Merge results
compile-standalone  →   Install CLI               →   Post summary
Upload artifact         Configure auth
                        Run single scenario
```

### Required Secrets

- `CLINE_API_KEY` - Cline API key

### Viewing Results

- Actions tab → "Smoke Tests" workflow
- View "Summary" for quick results
- Download "smoke-test-results" artifact for details

## TODO

- [ ] **Native tool calling tests**: Add CLI support for `native_tool_call_enabled` setting, then create a scenario that tests Claude 4 with native tool calling enabled (currently only GPT-5 models automatically use native tools via the Responses API)
