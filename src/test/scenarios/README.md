# Scenario Tests

This directory contains PR-specific scenario tests that run on top of the existing Playwright E2E framework. Each PR must provide exactly one scenario test file with a PR metadata comment for validation and CI gating.

## Overview

- Framework: Playwright, reusing the same E2E fixtures/utilities at `src/test/e2e/utils/`
- Config: Scenario runs are configured via `playwright.scenarios.config.ts`
- CI Workflow: `.github/workflows/scenario.yml`
- Validation: A script enforces “exactly one scenario per PR” with a metadata comment

## Architecture

Scenario tests reuse the E2E fixture stack:
- `e2e` fixture from `src/test/e2e/utils/helpers.ts` bootstraps VS Code, installs the extension VSIX, opens the Cline sidebar, and provides utilities (`helper`, `sidebar`, etc.).
- Scenario tests live here in `src/test/scenarios`, using the same Playwright helpers and patterns as E2E but focused on validating PR-specific behavior.
- Scenario tests are intended to be short, focused validations of the change introduced in the PR.

Key pieces:
- `playwright.scenarios.config.ts` points Playwright to this directory and reuses the shared E2E global setup to keep behavior identical.
- `scripts/validate-scenario.sh` checks that a PR includes exactly one scenario test with a metadata line identifying the PR number.
- `.github/workflows/scenario.yml` runs validation, then runs the Playwright scenario matrix on Ubuntu/Windows/macOS, then aggregates results in a single summary job.

## File Layout

- `example.ts` — A template/example scenario (exempt from validation)
- `*.ts` — Your PR-specific scenario tests (top-level only; not recursive)

Only top-level `.ts` files in this directory are scanned by the validator. Subdirectories are not scanned.

## Authoring a Scenario

Add a new file in this directory for your PR, and include the PR metadata comment. Exactly one scenario per PR is required.

Template:

```ts
import { expect } from "@playwright/test"
import { e2e } from "../e2e/utils/helpers"

// Title – Short, descriptive name.
// Description – Purpose of the scenario and any relevant background.
// Preconditions – State the environment, data, or setup required.
// Steps – Numbered, detailed instructions for execution.
// Expected Results – The specific outcome that constitutes a pass.
// Priority – High/Medium/Low, depending on risk.
// GitHub PR - 123  <-- REQUIRED: replace 123 with your PR number

e2e("Scenario - PR 123 - brief description", async ({ helper, sidebar }) => {
  await helper.signin(sidebar)
  // ... your steps ...
  await expect(sidebar.getByTestId("chat-input")).toBeVisible()
})
```

Notes:
- `example.ts` is exempt and will be ignored by the validator.
- The PR metadata comment must match the pattern: `// GitHub PR - <number>`.
- Exactly one scenario with the current PR number must exist.

## Running Locally

### Quick run (recommended)
Runs packaging, VS Code/Chromium setup, then the scenario tests:

```bash
npm run test:scenarios:optimal
```

This will:
1) Package the extension VSIX used for testing
2) Ensure Playwright Chromium and VS Code test binary are installed
3) Execute Playwright using `playwright.scenarios.config.ts`

### Validate your scenario metadata locally
The validator enforces “one scenario per PR” by scanning the metadata line:

```bash
# Fails if no scenario exists for PR 123 (or if multiple exist, or metadata is malformed)
bash scripts/validate-scenario.sh 123
```

Tip: To simulate success quickly:

```bash
printf '%s\n%s\n' '// GitHub PR - 123' 'export {}' > src/test/scenarios/pr-123.ts
bash scripts/validate-scenario.sh 123
rm src/test/scenarios/pr-123.ts
```

### Using act to run the workflow locally (Linux-only)
`act` cannot run macOS/Windows runners. Map Ubuntu runner to a Docker image and run:

```bash
# Validate then run the Ubuntu scenario job
act -W .github/workflows/scenario.yml -P ubuntu-latest=catthehacker/ubuntu:act-latest
```

Note: macOS/Windows jobs will be skipped under `act`. The GitHub-hosted Actions will run all three OS jobs.

## CI / GitHub Actions Setup

Workflow file: `.github/workflows/scenario.yml`

Jobs:
1) `matrix_prep` — Builds the 3-OS matrix
2) `validate-scenario` — Ensures PR has exactly one scenario with `// GitHub PR - <number>` (skips validation for non-PR events)
3) `scenarios` — Runs Playwright across Ubuntu/Windows/macOS
4) `scenario-summary` — Single summary status check that fails if any OS job fails

### Enforcing “must run before merging”
Use Branch Protection Rules:
1) Repo → Settings → Branches → Add/Edit rule for `main`
2) Enable “Require status checks to pass before merging”
3) Select `scenario-summary` as a required check
4) Optionally enable “Require branches to be up to date before merging”

This blocks merges until:
- The validator passes (exactly one scenario per PR with correct metadata)
- All three OS scenario runs pass

## Troubleshooting

- “No scenario file found for PR #<n>”
  - Ensure exactly one `.ts` file in this directory (excluding `example.ts`) includes the line:
    `// GitHub PR - <n>`
  - Ensure the file is top-level (not in a subdirectory).

- “Malformed ‘GitHub PR’ metadata line”
  - The line must be a single-line comment containing a numeric PR:
    `// GitHub PR - 123`

- “Multiple scenario files found for PR #<n>”
  - Reduce to exactly one scenario file for the PR.

- `act` skips macOS/Windows
  - This is expected. On GitHub Actions, those OS jobs will run.

- Slow first runs locally/CI
  - The E2E/Scenario flows download VS Code and Playwright Chromium. Caches in CI should speed up subsequent runs.

## See Also

- E2E fixtures and helpers: `src/test/e2e/utils/`
- Scenario Playwright config: `playwright.scenarios.config.ts`
- Scenario workflow: `.github/workflows/scenario.yml`
- Validator: `scripts/validate-scenario.sh`
