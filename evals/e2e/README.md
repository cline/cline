# E2E Agent Tests

Full end-to-end tests using real-world tasks from cline-bench.

## Overview

These tests run Cline against production-grade coding problems derived from actual user sessions. Each task:
- Starts with a broken codebase in Docker
- Gives Cline the task description
- Verifies the fix with pytest

## Prerequisites

1. **Python 3.13 with uv**
   ```bash
   # macOS
   brew install python@3.13
   pip install uv
   ```

2. **Harbor** (benchmark execution framework)
   ```bash
   uv tool install harbor
   ```

3. **Docker** (for local execution)
   ```bash
   # Verify Docker is running
   docker info
   ```

4. **API Keys**
   ```bash
   export ANTHROPIC_API_KEY=sk-ant-...
   # or
   export API_KEY=sk-ant-...  # Generic fallback
   ```

## Running Locally

```bash
# Run all tasks with default settings (Anthropic, Docker)
npx tsx evals/e2e/run-cline-bench.ts

# Run specific task
npx tsx evals/e2e/run-cline-bench.ts --tasks discord

# Use different provider/model
npx tsx evals/e2e/run-cline-bench.ts --provider openai --model gpt-4o

# Run on Daytona cloud (faster, parallel)
export DAYTONA_API_KEY=dtn_...
npx tsx evals/e2e/run-cline-bench.ts --env daytona

# Output to JSON
npx tsx evals/e2e/run-cline-bench.ts --output results.json
```

## CLI Options

| Option | Default | Description |
|--------|---------|-------------|
| `--env` | `docker` | Execution environment: `docker` or `daytona` |
| `--provider` | `anthropic` | Provider: `anthropic`, `openai`, `openrouter`, `gemini` |
| `--model` | `claude-sonnet-4-20250514` | Model ID |
| `--tasks` | `all` | Task filter pattern |
| `--trials` | `1` | Number of trials per task |
| `--output` | - | Write JSON results to file |

## Tasks

Current tasks from cline-bench (12 total):

1. **every-plugin-api-migration** - Migrate API calls in plugin
2. **police-sync-segfault** - Fix segmentation fault
3. **intercept-axios-error-handling** - Fix Axios error handling
4. **telegram-plugin-refactor** - Refactor Telegram plugin
5. **discord-trivia-approval-keyerror** - Fix KeyError in Discord bot
6. **terraform-azurerm-deployment-stacks** - Terraform provider fix
7. **orpc-client-migration** - Client migration task
8. **v-edit-workspace-tests** - Fix workspace tests
9. **healthchain-prefetch-removal** - Remove prefetch logic
10. **aenet-pytorch-pbc-neighborlist** - PyTorch PBC fix
11. **suave-http-data-bleeding** - Fix HTTP data bleeding
12. **filmarchiver** - Film archiver fixes

## CI Integration

These tests run nightly (not on every PR) due to:
- Long execution time (20-30 min per task)
- API costs (~$1-5 per run depending on model)
- Docker/Daytona infrastructure requirements

See `.github/workflows/nightly-evals.yml` for CI configuration.

## Results

Results are written to `evals/cline-bench/jobs/` directory by Harbor:

```
jobs/
└── 2025-01-25__10-00-00/
    ├── result.json              # Aggregate results
    └── <task-id>__<hash>/
        ├── result.json          # Trial result
        ├── agent/cline.txt      # Conversation log
        └── verifier/reward.txt  # 1 (pass) or 0 (fail)
```

## Troubleshooting

### "Harbor not found"

```bash
source .venv/bin/activate  # If using venv
uv tool install harbor
```

### "Docker not available"

```bash
# Start Docker daemon
docker info  # Should show Docker info
```

### Task timeouts

Some tasks (Qt WASM, Android) can take 20-30 minutes. If running locally, ensure Docker has sufficient resources (8GB+ RAM).
