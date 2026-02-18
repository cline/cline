# Cline Evals Architecture

## Overview

The evals system provides multi-layered testing for Cline's AI capabilities.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           TESTING PYRAMID                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│                              ┌─────────┐                                    │
│                             /   E2E    \         Layer 3: Full Agent        │
│                            /  cline-   \         - Real coding tasks        │
│                           /   bench     \        - Harbor execution         │
│                          /_______________\       - Nightly runs             │
│                                                                             │
│                        ┌───────────────────┐                                │
│                       /    Smoke Tests     \     Layer 2: Provider          │
│                      /   run-smoke-tests    \    - 5 curated scenarios      │
│                     /    (cline provider)    \   - 3 models via Vercel      │
│                    /_________________________\   - pass@k metrics           │
│                                                                             │
│              ┌─────────────────────────────────┐                            │
│             /        Contract Tests            \  Layer 1: Unit             │
│            /   thinking-traces.test.ts          \ - No LLM calls            │
│           /    tool-parsing.test.ts              \ - Fast, deterministic    │
│          /______________________________________ \ - API format validation  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Directory Structure

```
evals/
├── ARCHITECTURE.md          # This file
├── README.md                # Quick start guide
│
├── analysis/                # Shared metrics & reporting
│   └── src/
│       ├── metrics.ts       # pass@k, pass^k, flakiness calculations
│       └── cli.ts           # Analysis CLI
│
├── smoke-tests/             # Layer 2: Provider smoke tests
│   ├── run-smoke-tests.ts   # Main runner
│   ├── README.md            # Usage docs
│   ├── scenarios/           # Test definitions
│   │   ├── 01-create-file/
│   │   │   ├── config.json  # Prompt, expected files/content
│   │   │   ├── template/    # Initial files (if any)
│   │   │   └── workspace/   # Working dir (cleaned each run)
│   │   ├── 02-edit-file/
│   │   ├── 03-read-summarize/
│   │   ├── 04-multi-file/
│   │   └── 05-typescript-function/
│   └── results/             # Generated outputs
│       ├── latest -> 2026-01-27T.../  # Symlink to most recent
│       └── 2026-01-27T19-50-54-391Z/
│           ├── report.json  # Full results
│           ├── summary.md   # CI-friendly markdown
│           └── 01-create-file/
│               └── claude-sonnet/
│                   ├── trial-1.log           # CLI stdout/stderr
│                   └── workspace-trial-1/    # Kept for failures only
│
├── e2e/                     # Layer 3: Full agent E2E
│   ├── run-cline-bench.ts   # Harbor runner
│   └── README.md
│
└── cline-bench/             # Git submodule with real coding tasks
    └── tasks/               # SWE-bench style problems
```

## Smoke Test Workflow

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                         SMOKE TEST EXECUTION FLOW                            │
└──────────────────────────────────────────────────────────────────────────────┘

 npm run eval:smoke
        │
        ▼
┌───────────────────┐
│ Load scenarios    │  Read config.json from each scenarios/* dir
│ from disk         │
└────────┬──────────┘
         │
         ▼
┌───────────────────┐
│ Create results    │  evals/smoke-tests/results/2026-01-27T.../
│ directory         │
└────────┬──────────┘
         │
         ▼
┌───────────────────────────────────────────────────────────────┐
│                    FOR EACH SCENARIO                          │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │                  FOR EACH MODEL                         │  │
│  │  ┌───────────────────────────────────────────────────┐  │  │
│  │  │           RUN 3 TRIALS SEQUENTIALLY               │  │  │
│  │  │                                                   │  │  │
│  │  │  Trial 1 ──► Trial 2 ──► Trial 3 ──► Results      │  │  │
│  │  │  (Sequential - Cline instance handles one at a time)  │  │
│  │  │                                                   │  │  │
│  │  │  Each trial:                                      │  │  │
│  │  │  1. Create workspace-trial-N/                     │  │  │
│  │  │  2. Copy template files (if any)                  │  │  │
│  │  │  3. Run: cline -y -o "prompt"                     │  │  │
│  │  │  4. Verify expected files exist                   │  │  │
│  │  │  5. Verify expected content                       │  │  │
│  │  │  6. Save trial-N.log                              │  │  │
│  │  │  7. If failed, copy workspace to results/         │  │  │
│  │  └───────────────────────────────────────────────────┘  │  │
│  │                         │                               │  │
│  │                         ▼                               │  │
│  │  ┌───────────────────────────────────────────────────┐  │  │
│  │  │ Calculate metrics: pass@1, pass@3, pass^3, flaky  │  │  │
│  │  └───────────────────────────────────────────────────┘  │  │
│  └─────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────┘
         │
         ▼
┌───────────────────┐
│ Generate outputs  │
│ - report.json     │
│ - summary.md      │
│ - latest symlink  │
└───────────────────┘
```

## Models Tested

```
┌─────────────────────────────────────────────────────────────────┐
│                    CLINE PROVIDER ROUTING                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   ┌─────────────┐                                               │
│   │ Smoke Test  │                                               │
│   │   Runner    │                                               │
│   └──────┬──────┘                                               │
│          │                                                      │
│          │  cline -y -o "prompt" --model <model>                │
│          │                                                      │
│          ▼                                                      │
│   ┌─────────────┐                                               │
│   │   Cline     │                                               │
│   │  Provider   │ ◄─── Uses your Cline auth (cline auth)        │
│   └──────┬──────┘                                               │
│          │                                                      │
│          │ Routes to backend                                    │
│          ▼                                                      │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │                   Default Models                        │   │
│   ├─────────────────────────────────────────────────────────┤   │
│   │  claude-sonnet-4-20250514                               │   │
│   │  gpt-4o                                                 │   │
│   │  gemini-2.5-pro-preview-06-05                           │   │
│   └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Metrics Explained

```
┌─────────────────────────────────────────────────────────────────┐
│                        METRICS                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  pass@k   "What's the probability of getting at least one      │
│            success if I run k trials?"                          │
│                                                                 │
│            Example: 2/3 trials pass → pass@3 ≈ 96%              │
│            (Very likely to pass if you run 3 times)             │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  pass^k   "What's the probability of ALL k trials succeeding?" │
│                                                                 │
│            Example: 2/3 trials pass → pass^3 ≈ 30%              │
│            (Only 30% chance all 3 would pass)                   │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Status   PASS  = All trials passed                             │
│           FLAKY = Some passed, some failed                      │
│           FAIL  = All trials failed                             │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Quick Commands

```bash
# Run all smoke tests (all models, 3 trials each)
npm run eval:smoke

# Run single model (use exact model ID for reproducibility)
npm run eval:smoke -- --model claude-sonnet-4-20250514

# Run single scenario
npm run eval:smoke -- --scenario 01-create-file

# Quick check (1 trial)
npm run eval:smoke -- --trials 1

# CI-like run (builds CLI from source, single trial)
npm run eval:smoke:ci

# View latest results
cat evals/smoke-tests/results/latest/summary.md

# Debug a failure
cat evals/smoke-tests/results/latest/<scenario>/<model>/trial-1.log
ls evals/smoke-tests/results/latest/<scenario>/<model>/workspace-trial-1/
```

## CI Integration

Smoke tests run automatically on merge to `main` via `.github/workflows/cline-evals-regression.yml`.

**Triggers:**
- Push to `main` branch (paths: `src/core/**`, `src/shared/**`, `proto/**`)
- Manual dispatch via `workflow_dispatch`

**What it does:**
1. Builds the Go CLI from source via `scripts/run-smoke-tests.sh`
2. Runs all 5 scenarios × 3 models × 1 trial
3. Uploads results as artifact
4. Posts summary to GitHub Actions job summary

```bash
# The CI runs this script which handles proto generation + CLI build:
bash scripts/run-smoke-tests.sh --trials 1
```

### Viewing CI Results

1. **Job Summary**: Each run posts results to the Actions tab
2. **Artifacts**: Full results downloadable as `smoke-test-results-<run_id>`

### Running CI-like Tests Locally

```bash
# One command - builds CLI from source and runs tests
npm run eval:smoke:ci

# Or manually:
npm run protos-go
cd cli && go build -o cline ./cmd/cline
export PATH="$(pwd)/cli:$PATH"
npx tsx evals/smoke-tests/run-smoke-tests.ts --trials 1
```

### Why Build CLI in CI?

We build the Go CLI from source rather than using a pre-built release because:
- Tests actual CLI code from the commit (catches CLI regressions)
- Proto definitions may have changed
- No dependency on external releases

## Contract Tests (Layer 1)

> **Note**: The old `evals/benchmarks/tool-precision/` tests have been removed. Their functionality is now covered by contract tests in `src/core/**/__tests__/` and the 52 system prompt snapshot tests that run with `npm run test:unit`.

Located in `src/core/api/transform/__tests__/`:

```
thinking-traces.test.ts
├── convertToOpenAiMessages preserves reasoning_details
├── convertToAnthropicMessage preserves thinking blocks
└── sanitizeGeminiMessages handles provider-specific cleaning

tool-parsing.test.ts
├── Anthropic tool_use → OpenAI tool_calls conversion
├── Tool call ID truncation (>40 chars)
├── OpenAI Responses API ID transformation
└── Tool result matching
```

Run with:
```bash
npm run test:unit -- --grep "Thinking Trace"  # 9 tests
npm run test:unit -- --grep "Tool Call"       # 11 tests
```
