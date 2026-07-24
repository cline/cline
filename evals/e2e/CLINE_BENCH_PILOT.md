# Cline SDLC benchmark pilot

This pilot uses three deterministic, production-derived `cline-bench` tasks:

1. reproduce and fix an Axios/React Query error-handling bug, including tests;
2. create oRPC infrastructure and migrate a Next.js application across files;
3. refactor a TypeScript monorepo plugin and remove obsolete architecture.

The run order is interleaved as a Latin square so each model sees every task in
a different position. Each task runs once, sequentially, inside its own Docker
environment and is graded by the task's deterministic verifier.

## Safety

- Dry-run is the default. Paid calls require `--execute`.
- The config rejects 100 or more tasks or dollars per model.
- Harbor receives a small environment allowlist, not the host environment.
- Jobs and traces are written outside the repository with private permissions.
- Authentication is inherited only through `CLINE_API_KEY`; it is never stored
  in the config, command arguments, report, or repository.
- The Cline CLI version is pinned in configuration for reproducibility. Its
  built-in consecutive-mistake limit remains enabled.
- The default pilot is bounded to 3 tasks/model, $15/model or less, and $40
  globally.
- `routerProfile` is validated. A `cline-pass-router` experiment rejects every
  model that does not use a public `cline-pass/*` ID.
- The Pass profile uses Cline's distinct `cline-pass` CLI provider and derives
  Harbor's scoped `API_KEY` alias only from the required `CLINE_API_KEY`
  environment value; neither value is written to disk or command arguments.
- Optional per-model token prices add cache-read ratio, estimated warm cost,
  cold-equivalent cost, and estimated cache savings to each report result.
- `costBasis` distinguishes ordinary reported inference cost from ClinePass
  reference-quota cost. ClinePass is subscription-billed, so its per-run dollar
  telemetry is useful for quota/economic comparisons but is not an invoice.
- The timeout is enforced both in Cline and at Harbor's outer agent boundary;
  interrupted runs count as timed-out failures and retain their usage totals.
- The Telegram verifier is copied to a private per-run overlay that adds
  `/root/.local/bin` to PATH. This fixes its upstream `uv` lookup bug without
  dirtying or forking the `cline-bench` submodule.
- Harbor exposes cost telemetry after a task completes, not while it is
  running. Therefore dollar limits stop subsequent work, and the 25-minute
  wall timeout is the proactive in-task bound.

## Usage

Validate the exact matrix without spending:

```bash
bun evals/e2e/run-cline-bench-pilot.ts
```

Run it after securely exporting a Cline credential:

```bash
CLINE_API_KEY="$CLINE_API_KEY" \
  bun evals/e2e/run-cline-bench-pilot.ts --execute
```

Models, task IDs, timeouts, and budget limits are data in
`evals/e2e/cline-bench-pilot.config.json`. Copy that file outside the
repository and pass `--config /absolute/path/config.json` for another arm.
The checked-in `evals/e2e/cline-bench-pass-pilot.config.json` uses the same
runner and verifier tasks but constrains candidates to the public Cline Pass
catalog:

```bash
bun evals/e2e/run-cline-bench-pilot.ts \
  --config evals/e2e/cline-bench-pass-pilot.config.json
```

Use `--stop-after N` to end cleanly after a matrix position; rerunning with the
same `--jobs-root` reuses verified completed work.
Use `--only-run N` to execute one missing matrix position while still loading
completed prior costs into the budget ledger.
