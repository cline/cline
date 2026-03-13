# Local Latency Observer Plan for Remote-Workspace Comparison

This document describes a plan for building a **locally visible latency observer** for Cline that can be added to a branch derived from `main` **and** to a branch derived from `eve_troubleshooting-remote-workspaces`, so that behavior can be observed and compared under the same measurement mechanism.

The goal is not to recreate the old `arafatkatze/ping-pong-test` branch literally. That older work is useful as inspiration because it validated an important product-development idea:

> engineers need a fast, visible, low-friction way to observe latency behavior locally while iterating.

But the repository has changed substantially since then. The right move now is to design a measurement mechanism that fits the current architecture, is useful on both baseline and candidate branches, and helps engineers compare **user-perceived latency behavior**, not just transport RTT in isolation.

---

## What This Artifact Is

This is an **implementation plan / extraction plan** for a Staff+ level distributed systems and infrastructure engineer. It is not a greenfield “brainstorming” doc and it is not a narrow PR description.

Its purpose is to define a branch-portable observer mechanism that can:

- be added to `main`,
- be added to `eve_troubleshooting-remote-workspaces`,
- surface useful measurements locally,
- and support apples-to-apples comparison of baseline vs improved behavior.

The quality bar for this plan is:

- the mechanism must be easy to reason about,
- useful during iterative development,
- minimally invasive to product behavior,
- and explicit about what is being measured and what is not.

---

## Reference Inputs and Inspiration

This plan should be read alongside:

1. `docs/remote-workspace-latency-branch-analysis-report.md`
2. `docs/remote-workspace-latency-improvement-plan.md`
3. the current telemetry/validation tooling already present in this repo
4. the older inspiration branch `origin/arafatkatze/ping-pong-test`

The old branch appears to have included a visible `LatencyTester` UI in settings that measured gRPC ping/pong latency with variable payload sizes. That is a useful inspiration because it made latency locally visible and easy to probe. However, it is not enough by itself for the current task, because the current problem is broader than pure transport RTT.

Today we care about multiple layers of user-perceived latency, including:

- UI transport latency,
- snapshot / delta delivery behavior,
- chunk-to-visible-update timing,
- request-start latency,
- and hot-path churn during active execution.

So the modern observer should retain the spirit of “easy visible local latency testing” while measuring the parts of the system that matter most for the remote-workspace problem.

---

## Core Goal

Build a **single observer mechanism** that can be added to both baseline and candidate branches and used to compare their behavior in a way that is:

- visible to the developer locally,
- useful during manual iteration,
- scriptable enough to support repeatable experiments,
- and robust to architectural differences between `main` and `eve_troubleshooting-remote-workspaces`.

---

## Non-Goals

To keep the effort focused, this observer should **not** try to be all of the following at once:

- a benchmark harness for every product surface,
- a production telemetry dashboard,
- a load-testing framework,
- or a branch-specific debugging toy that only works on one side of the comparison.

Instead, it should be a **branch-portable latency observation layer** with a small visible UI and enough instrumentation hooks to answer the comparison questions we care about.

---

## Guiding Principles

Before implementation, keep these principles in mind:

- **Optimize for comparability over cleverness.** A simpler observer that works identically on both branches is better than a richer observer that only works on one.
- **Measure user-perceived boundaries, not just transport boundaries.** Ping/pong RTT is useful, but it is only one slice of the problem.
- **Separate observer plumbing from branch-specific latency improvements.** The observer should not depend on the candidate branch’s optimizations in order to function.
- **Make local visibility first-class.** Developers should be able to see measurements in the UI during manual testing, not only in exported logs.
- **Be smart about backward compatibility.** If the observer can gracefully detect missing richer metrics on `main` and still provide useful output, that is preferable to forcing two divergent observer implementations.

---

## Recommended High-Level Shape

The best shape for this feature is a **three-layer observer**:

1. **Transport probe layer** — lightweight ping/pong style measurements with variable payload sizes.
2. **Task-execution latency layer** — timing measurements around request start, first visible update, state update frequency/size, and optional chunk-to-visible metrics where supported.
3. **Local observer UI layer** — a developer-facing panel or settings section that displays current values, rolling history, and recent logs in a human-comprehensible way.

This approach preserves the useful simplicity of the old `LatencyTester` while expanding it into something aligned with the current problem space.

---

## Why a Single Branch-Portable Observer Matters

If the observer mechanism differs substantially between baseline and candidate branches, then comparison quality degrades immediately. Engineers start asking questions like:

- is the difference real or an artifact of the measurement tool?
- does one branch surface richer metrics only because it has extra plumbing?
- are we comparing the same event boundaries?

The smart move is to design the observer so that:

- a **minimum shared metric set** works on both branches,
- richer metrics can appear opportunistically where supported,
- and the UI makes clear which metrics are available vs unavailable on the current branch.

That way a single observer branch can be rebased/cherry-picked onto both `main` and `eve_troubleshooting-remote-workspaces` with minimal divergence.

---

## Recommended Measurement Categories

## 1. Transport probe metrics

These are inspired most directly by the old ping-pong tester.

Measure:

- [ ] round-trip UI service ping latency
- [ ] effect of varying payload sizes
- [ ] repeated sample min/max/avg/current
- [ ] continuous test mode for drift/jitter observation

Why it matters:

- helps reveal raw extension-host ↔ webview transport overhead,
- useful in remote environments like Codespaces / SSH / remote containers,
- easy for a developer to understand immediately.

Limitations:

- does **not** directly measure task-execution UX,
- should be treated as a lower-level signal, not the only KPI.

## 2. Task lifecycle metrics

Measure:

- [ ] task creation / initialization latency
- [ ] request-start latency
- [ ] time to first visible assistant update
- [ ] time to first full-state update
- [ ] time to first partial or delta update where available

Why it matters:

- these metrics align better with the user’s lived experience than transport RTT alone,
- they can show whether the candidate branch improves perceived responsiveness at important boundaries.

## 3. Hot-path churn metrics

Measure:

- [ ] number of full-state pushes per request
- [ ] total full-state payload bytes per request
- [ ] number of partial-message events per request
- [ ] number of task UI deltas per request where supported
- [ ] persistence flush counts where supported

Why it matters:

- these are the metrics most closely tied to the remote-workspace improvements described in the analysis report,
- they help explain *why* one branch feels faster, not just whether it does.

## 4. Comparison session metadata

Record:

- [ ] branch / commit identity
- [ ] local vs remote environment marker
- [ ] selected scenario / payload size / cadence mode
- [ ] timestamped session logs

Why it matters:

- makes manual comparisons auditable,
- prevents confusion when developers are switching between baseline and candidate runs.

---

## Branch-Portability Strategy

This is the most important design constraint.

The observer should be implemented so that it degrades gracefully:

### Minimum cross-branch baseline

These should work on both `main` and `eve_troubleshooting-remote-workspaces` with little or no branch-specific logic:

- [ ] ping/pong RTT with configurable payload size
- [ ] task initialization timing if a simple observer hook can be added
- [ ] first state update timing
- [ ] visible branch/commit/session labeling
- [ ] local UI for logs and rolling stats

### Opportunistic richer metrics

These may only exist natively on `eve_troubleshooting-remote-workspaces` or may require additional light plumbing on `main`:

- [ ] chunk-to-webview timing
- [ ] full-state post counts / bytes
- [ ] partial-message event counts
- [ ] task UI delta counts
- [ ] persistence flush metrics

### Recommended implementation rule

The observer UI should not fail if a metric is unavailable.

Instead it should display something like:

- “supported and active”
- “unsupported on this branch”
- or “observer hook not installed”

That makes the same branch usable on both baselines.

---

## Recommended Developer UX

The observer should be easy enough to use that engineers actually use it during iteration.

Recommended UI features:

- [ ] a dedicated dev-facing section in Settings or a dev/debug panel
- [ ] buttons for:
  - [ ] single ping
  - [ ] continuous ping
  - [ ] test all payload sizes
  - [ ] start observed task scenario
  - [ ] reset stats
- [ ] visible stats cards / table for current/min/max/avg
- [ ] recent logs panel
- [ ] session metadata display (branch, commit, environment)
- [ ] explicit note describing which metrics are branch-portable vs richer-on-candidate

The point is to make the observer *pleasant enough* that it becomes part of the engineering workflow rather than a script that only gets used once.

---

## Recommended Implementation Plan

## Step 1 — Define the minimum shared metric contract

### Goal

Create the smallest metric surface that can work on both `main` and `eve_troubleshooting-remote-workspaces`.

### Mental model

The observer succeeds if its core contract is branch-portable. Everything richer is an enhancement.

### Work

- [x] Define a shared observer metric model for:
  - [x] ping RTT samples
  - [x] task initialization / request-start samples
  - [x] first-visible-update samples
  - [x] optional richer counters
- [x] Mark each metric as either:
  - [x] required/shared
  - [x] optional/richer

### Detailed code changes

- Add a shared type module, e.g. `src/shared/LatencyObserver.ts` or similar, that defines:
  - [x] sample types,
  - [x] rolling stats shape,
  - [x] branch capability flags,
  - [x] session metadata shape.

### Tests

- [x] Unit test: metric aggregation shape is stable.
- [x] Unit test: missing optional metrics do not break the model.

---

## Step 2 — Reintroduce a modern ping/pong transport probe

### Goal

Port the useful idea from the old `LatencyTester` branch into the current architecture in a modernized form.

### Mental model

This is the simplest locally visible measurement and should serve as the “does the pipe feel slow?” test.

### Work

- [x] Add or confirm a simple UI-service ping endpoint that accepts payload size.
- [x] Measure round-trip latency in the webview using `performance.now()`.
- [ ] Support multiple payload sizes and continuous testing.

### Detailed code changes

- Inspect whether the current codebase already has a UI ping path analogous to the old branch’s `UiServiceClient.ping(...)` flow.
- If missing, add:
  - [x] a lightweight request/response endpoint in the UI service layer,
  - [x] optional payload-size expansion to simulate message size effects.
- In the webview, add a dev-facing component similar in spirit to the old `LatencyTester.tsx`, but keep it isolated behind a dev/debug visibility gate.

### Tests

- [x] Unit/integration test: ping returns successfully.
- [x] Test: payload size selection is reflected in the request.
- [ ] Regression test: continuous mode handles pending request overlap safely.

---

## Step 3 — Add a task-observer hook layer that is intentionally branch-portable

### Goal

Create a small observer hook interface that can be invoked from task lifecycle boundaries on both branches.

### Mental model

Do **not** couple the observer directly to candidate-branch-only telemetry structures. Instead create a tiny observer API that can be wired into either branch with minimal intrusion.

### Work

- [ ] Define a branch-portable observer service or callback layer.
- [ ] Add hooks for:
  - [ ] task initialization start/end
  - [ ] request start
  - [ ] first visible update
  - [ ] request completion
- [ ] Keep richer optional hooks for state-post counts, chunk-to-webview, etc.

### Detailed code changes

- Add a small service such as `LatencyObserverService` or similarly named utility in `src/services/` or `src/core/controller/`.
- It should:
  - [ ] record timestamps,
  - [ ] aggregate per-session/per-request values,
  - [ ] expose results to the UI layer,
  - [ ] not require the full candidate telemetry pipeline to exist.

### Tests

- [ ] Unit test: initialization and request lifecycle timings aggregate correctly.
- [ ] Unit test: optional hooks can be absent without crashing.

---

## Step 4 — Expose richer metrics when available, without making them required

### Goal

Allow the same observer branch to become more informative on `eve_troubleshooting-remote-workspaces` without breaking on `main`.

### Mental model

Think of this as capability detection, not branch forking.

### Work

- [ ] Integrate existing richer latency metrics when present:
  - [ ] `task.latency_metrics`
  - [ ] initialization telemetry
  - [ ] payload-size accounting
  - [ ] chunk-to-webview summaries
- [ ] Surface unsupported metrics as unavailable instead of failing.

### Detailed code changes

- Where current richer telemetry exists (candidate branch or current branch after instrumentation work), add adapters that feed it into the observer UI.
- On `main`, either:
  - [ ] wire minimal equivalents if easy,
  - [ ] or leave those fields explicitly unsupported.

### Tests

- [ ] Unit test: richer metrics adapter populates observer state when data exists.
- [ ] Unit test: missing richer metrics are displayed as unavailable.

---

## Step 5 — Build a visible local observer UI

### Goal

Create a developer-facing UI for running probes and reading results locally.

### Mental model

If the observer is only visible in logs, engineers will underuse it. The UI should make latency behavior tangible.

### Work

- [ ] Add a dev/debug observer panel or settings section.
- [ ] Show transport stats, lifecycle stats, optional richer metrics, and logs.
- [ ] Display branch/session/environment metadata.

### Detailed code changes

- Add a component in `webview-ui/src/components/settings/` or a more appropriate dev/debug location.
- Prefer a design inspired by the old `LatencyTester`:
  - [ ] simple controls,
  - [ ] rolling stats,
  - [ ] recent logs,
  - [ ] easy reset.
- Add session identity fields:
  - [ ] git branch or commit label if available from backend,
  - [ ] environment marker (local vs remote),
  - [ ] capability flags for richer metrics.

### Tests

- [ ] Component test: controls trigger expected actions.
- [ ] Component test: unavailable metrics render intelligibly.
- [ ] Regression test: UI remains hidden or low-noise outside intended dev/debug usage.

---

## Step 6 — Add scenario-driven observation, not just passive measurement

### Goal

Give developers a way to drive comparable scenarios, not just watch idle telemetry.

### Mental model

A latency observer becomes far more valuable when it can help the developer answer:

- how does branch A behave during a simple request?
- how does branch B behave during the same request?
- what happens under larger payloads or high-churn streaming?

### Work

- [ ] Define a small set of recommended scenarios:
  - [ ] pure ping test
  - [ ] short assistant response
  - [ ] long streaming response
  - [ ] tool-heavy / high-churn scenario
  - [ ] large-file-write-adjacent scenario if feasible
- [ ] Add UI affordances or documented steps for running those scenarios repeatedly.

### Detailed code changes

- This does not necessarily require the UI to generate tasks itself.
- At minimum, add a documented scenario matrix and a way for the observer to reset/session-label around a manual run.
- If practical, add a small “start known validation task” action in dev mode.

### Tests

- [ ] Validation test: scenario runs produce observer output.
- [ ] Regression test: observer reset cleanly separates sessions.

---

## Step 7 — Support export and comparison workflow

### Goal

Make it easy to compare baseline vs candidate observations after local runs.

### Mental model

Local visibility is great, but engineers also need artifacts they can compare side by side.

### Work

- [ ] Add export of observer session data to JSON.
- [ ] Include branch/commit/environment metadata in export.
- [ ] Make exported structure easy to diff or post-process.

### Detailed code changes

- Add an export button or command that writes a session artifact.
- Keep schema intentionally simple:
  - [ ] session metadata,
  - [ ] ping samples and aggregates,
  - [ ] lifecycle measurements,
  - [ ] richer metrics if available,
  - [ ] recent logs or event markers.

### Tests

- [ ] Unit test: exported schema is stable.
- [ ] Regression test: export works even when optional metrics are unavailable.

---

## Step 8 — Make the observer safe for use on both `main` and candidate branches

### Goal

Minimize branch-specific surgery so the same observer work can be reused for baseline and future comparison runs.

### Mental model

The observer should behave like a thin compatibility layer, not a second product architecture.

### Work

- [ ] Avoid relying on candidate-only classes for core functionality.
- [ ] Gate richer behavior via capability detection.
- [ ] Keep backend hooks shallow and intentionally placed.

### Detailed code changes

- Prefer hooks at stable abstraction boundaries:
  - [ ] UI service layer for ping/pong,
  - [ ] controller/task lifecycle boundaries for timing,
  - [ ] optional adapters for richer telemetry.
- Avoid deep invasive branch-specific assumptions where possible.

### Tests

- [ ] Manual validation on `main`.
- [ ] Manual validation on `eve_troubleshooting-remote-workspaces`.
- [ ] Confirm that the same observer branch can be adapted onto both with minimal or no code drift.

---

## Step 9 — Document how to interpret the measurements

### Goal

Prevent engineers from misusing the observer or over-interpreting low-level numbers.

### Mental model

Numbers without interpretation guidance lead to bad product decisions.

### Work

- [ ] Document what ping RTT does and does not mean.
- [ ] Document how to compare first-visible-update and state-churn metrics.
- [ ] Document that the most important measurement is user-perceived latency, not just a single low-level counter.

### Detailed code changes

- Add an adjacent doc section or inline UI help text explaining:
  - [ ] transport RTT is a lower-level signal,
  - [ ] task lifecycle timings are closer to user perception,
  - [ ] churn metrics help explain cause,
  - [ ] branch comparison should use the same scenario and environment.

### Tests

- [ ] No code-heavy tests needed; verify docs/UI copy is clear.

---

## Minimal Coherent Extraction Boundary

The smallest useful PR for this observer should probably include:

- a modernized ping/pong probe,
- the shared observer metric contract,
- a small local UI panel,
- a minimal task lifecycle timing hook layer,
- and an export path.

What should not be split apart if avoidable:

- observer metric model from the UI,
- ping probe from the visible stats surface,
- branch/session metadata from exported artifacts,
- and capability labeling from optional richer metrics.

---

## Common Failure Modes

Watch for these explicitly:

- building a tester that only measures transport RTT and not user-perceived task latency,
- building a tester that only works on one branch,
- tightly coupling the observer to candidate-only telemetry plumbing,
- surfacing metrics without clarifying whether they are unavailable vs zero,
- and creating a debug UI that is so hidden or awkward that engineers stop using it.

---

## Recommended Validation Workflow

Once implemented, a good manual workflow would be:

1. apply the observer branch to `main`
2. run a fixed set of scenarios and export results
3. apply the same observer branch to `eve_troubleshooting-remote-workspaces`
4. run the same scenarios in the same environment
5. compare:
   - [ ] ping RTT behavior
   - [ ] initialization and first-visible-update timing
   - [ ] state push counts/bytes where available
   - [ ] partial/delta event behavior where available
   - [ ] subjective smoothness during the same manual workflow

That gives both a human and a machine-readable comparison story.

---

## Developer Checklist Summary

- [ ] Define a branch-portable shared metric contract
- [ ] Implement a modernized ping/pong transport probe
- [ ] Add a shallow branch-portable task observer hook layer
- [ ] Adapt richer metrics where available without making them required
- [ ] Build a visible local observer UI
- [ ] Support scenario-driven observation
- [ ] Add export/comparison workflow support
- [ ] Validate portability on both `main` and `eve_troubleshooting-remote-workspaces`
- [ ] Document how to interpret the results

---

## Final Mental Model Recap

- **The old ping-pong tester is inspiration, not a blueprint.**
- **The modern observer should measure both pipe latency and task-experience latency.**
- **A single branch-portable observer is much more valuable than two branch-specific testers.**
- **The best observer is one engineers will actually use while iterating.**

If implemented well, this mechanism will give the team a practical way to compare current behavior and future behavior using the same local visibility tool, which is exactly what the next stage of this work needs.