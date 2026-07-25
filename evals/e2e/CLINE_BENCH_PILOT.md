# Cline SDLC benchmark pilot

The small default smoke pilot uses three deterministic, production-derived
`cline-bench` tasks:

1. reproduce and fix an Axios/React Query error-handling bug, including tests;
2. create oRPC infrastructure and migrate a Next.js application across files;
3. refactor a TypeScript monorepo plugin and remove obsolete architecture.

The staged router checkpoint uses eight tasks across TypeScript, Python, C++,
and Go, with easy, medium, and hard debugging, migration, refactoring, and
implementation work. Its checked-in configuration is
`cline-bench-router-checkpoint.config.json`.

Run order is interleaved so each model sees its assigned task set in a different
position. Each task runs once, sequentially, inside its own Docker environment
and is graded by the task's deterministic verifier.

## Safety

- Dry-run is the default. Paid calls require `--execute`.
- The campaign checkpoint cannot exceed $50. Wave 1 reserves at most $35 and
  wave 2 reserves at most $15.
- `--execute` requires an explicit jobs root. Rerunning without intentionally
  naming the same root cannot silently start a second full campaign.
- A jobs-root lock rejects concurrent runners. Dead local owners are recovered
  atomically; ambiguous or live owners fail closed.
- Every run writes a durable declared-cost reservation before Harbor starts.
  An interrupted reservation with no unambiguous usage artifact blocks resume.
- Harbor receives a small environment allowlist, not the host environment.
- Jobs and traces are written outside the repository with private permissions.
- Authentication is inherited only through `CLINE_API_KEY`; it is never stored
  in the config, command arguments, report, or repository.
- The Cline CLI version is pinned in configuration for reproducibility. Its
  built-in consecutive-mistake limit remains enabled.
- Any explicit `local-core` transport also requires `localCoreRevision` to be
  the exact 40-character lowercase hexadecimal Core Git commit. It is printed
  in the dry-run summary and retained in the execution fingerprint, manifest,
  and report, so a different local Core build cannot silently reuse results.
- The default smoke pilot is bounded to 3 tasks/model, $15/model or less, and
  $40 globally.
- `routerProfile` is validated. A `cline-pass-router` experiment rejects every
  model that does not use a public `cline-pass/*` ID, and each profile requires
  its matching Cline CLI provider.
- Config, model, and pricing objects reject unknown fields, so accidentally
  adding a credential cannot copy it into the retained report.
- Reused job roots carry a content-addressed execution fingerprint covering the
  complete effective config, runner source hash, runner git commit, Harbor
  version, exact `cline-bench` submodule commit, and SHA-256 hashes of the
  exact task trees Harbor receives. The manifest is written before Harbor starts. Completed reused
  results also revalidate task, CLI version, served provider, and served model.
- The private jobs-root boundary is canonicalized through symlinks. If Harbor's
  outer process times out or exits abnormally, the runner removes only Docker
  containers whose trial IDs belong to that job and recovers usage when
  possible.
- The Pass profile uses Cline's distinct `cline-pass` CLI provider and derives
  Harbor's scoped `API_KEY` alias only from the required `CLINE_API_KEY`
  environment value; neither value is written to disk or command arguments.
- Optional per-model token prices add cache-read ratio, estimated warm cost,
  cold-equivalent cost, and estimated cache savings to each report result.
- `costBasis` distinguishes ordinary reported inference cost, ClinePass
  reference-quota cost, and `unmeasured`. A completed trial with no usage or
  cost telemetry is an `infrastructure_invalid` result: `costUsd` is null and
  `reservedExposureUsd` retains the full reservation as a conservative bound.
  The budget ledger records that bound as `unmeasured`, never as invented actual
  model cost, and the position is not silently retried. A canonical terminal
  error with explicit zero cumulative usage remains a legitimate measured
  zero-spend infrastructure failure.
  ClinePass is subscription-billed, so its per-run dollar telemetry is useful
  for quota/economic comparisons but is not an invoice.
- Paid execution fetches Cline's public recommended-model catalog before
  creating the jobs root or reserving budget. Fixed comparator IDs must be
  present in the relevant live catalog, regardless of transport; virtual Auto
  candidates keep Core's internal IDs and are not compared to public picker
  identifiers.
- When a virtual Auto arm uses local Core, paid execution also fetches that
  Core instance's recommended-model catalog from the host and requires the
  public virtual ID (`cline/auto` or `cline-pass/auto`) before creating the jobs
  root or reserving budget. A missing picker/catalog registration therefore
  cannot become a paid-looking CLI no-op.
- The timeout is enforced both in Cline and at Harbor's outer agent boundary.
  Harbor runs in its own process group; timeout and termination signals stop the
  group and task-scoped containers are removed. Interrupted usage is accepted
  only from exactly one attempt and the timestamp-latest cumulative snapshot.
- Harbor receives a verifier-only `PATH` containing `/root/.local/bin`. This
  fixes inconsistent `uv` lookup across the selected verifiers without changing
  the agent environment, task instructions, tests, or `cline-bench` submodule.
- Cline writes cumulative usage after each model turn. The runner polls that
  private JSONL every 250 ms and stops an active run at the reservation minus
  `max($0.55, 25%)` headroom (`$1.65` for a `$2.20` reservation). It persists a
  private recovery marker before terminating Harbor and its task container, so
  a stopped run is settled and never respent even if Harbor cannot finish its
  result file. One in-flight model call can still land after the last usage
  event, so a provider-side/prepaid account limit remains the only true dollar
  hard stop.
- Optional model-level `transport` is either `cline-api` or `local-core`.
  Explicit `local-core` arms require both the pinned config revision above and
  `--local-core-url` before the jobs root is created or budget is reserved. The
  URL remains deliberately narrow: it
  normalizes localhost ports 7777 or 17777 to `host.docker.internal`, forwards
  only `CLINE_API_BASE_URL`, and adds only that hostname to Harbor's environment
  and agent-phase allowlists. This lets fixed comparators and Auto share one
  controlled Core transport while other arms can continue to call Cline
  directly. Arbitrary URLs and environment passthrough are rejected. For
  backward compatibility, an unspecified transport still applies a supplied
  local Core URL only to `cline/auto` and `cline-pass/auto`.
- Virtual-model reports retain `requestedModel`, hashed benchmark task/session
  identifiers, and privacy-safe route evidence. Fixed-model results remain
  backward compatible.

## Usage

Validate the exact matrix without spending:

```bash
bun evals/e2e/run-cline-bench-pilot.ts
```

Run it after securely exporting a Cline credential:

```bash
CLINE_API_KEY="$CLINE_API_KEY" \
  bun evals/e2e/run-cline-bench-pilot.ts --execute \
  --jobs-root "$HOME/.cache/cline-auto-sdlc-bench/smoke-$(date +%Y%m%d)"
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
If the `cline-bench` commit, a selected task, or its effective verifier overlay
changes, the runner rejects that jobs root instead of reusing stale results.

## Staged router checkpoint

Validate the 24-run matrix without spending:

```bash
bun evals/e2e/run-cline-bench-pilot.ts \
  --config evals/e2e/cline-bench-router-checkpoint.config.json
```

Wave 1 runs `cline/auto` on all eight tasks and Kimi K3 plus GLM 5.2 on
Axios, Telegram, Every Plugin, and V-Edit. All three arms use the same local
Core transport. It reserves no more than $35.20:

```bash
CLINE_API_KEY="$CLINE_API_KEY" \
  bun evals/e2e/run-cline-bench-pilot.ts --execute --wave 1 \
  --config evals/e2e/cline-bench-router-checkpoint.config.json \
  --jobs-root "$HOME/.cache/cline-auto-sdlc-bench/router-checkpoint" \
  --local-core-url http://localhost:17777
```

Inspect wave 1 outcomes, route evidence, and the provider-side account limit
before releasing wave 2. Wave 2 adds GPT-5.6 Sol on all eight tasks, reserves
no more than another $14.40 through the direct Cline API, and shares the same
$50 campaign ledger and execution fingerprint:

```bash
CLINE_API_KEY="$CLINE_API_KEY" \
  bun evals/e2e/run-cline-bench-pilot.ts --execute --wave 2 \
  --config evals/e2e/cline-bench-router-checkpoint.config.json \
  --jobs-root "$HOME/.cache/cline-auto-sdlc-bench/router-checkpoint" \
  --local-core-url http://localhost:17777
```

Core route traces can be attached directly from the benchmark JSONL sink. The
runner validates the exact schema (including the privacy-safe routing features
and cache/switch gate), reads Cline's `session_id` from Harbor's private
`agent/trajectory.json`, and correlates it with Core's raw
`task_id_sha256 = SHA256(session_id)`. Reports retain only hashes, never the raw
session ID. The earlier camelCase six-field export remains accepted for
backward compatibility. Attach a trace export without calling a model:

```bash
bun evals/e2e/run-cline-bench-pilot.ts --ingest-route-traces \
  --route-traces /absolute/private/path/router-traces.jsonl \
  --config evals/e2e/cline-bench-router-checkpoint.config.json \
  --jobs-root "$HOME/.cache/cline-auto-sdlc-bench/router-checkpoint"
```
