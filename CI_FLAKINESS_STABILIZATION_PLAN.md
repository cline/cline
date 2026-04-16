 # CI Flakiness Stabilization Plan

 ## Purpose of this document

 This document is a standalone implementation plan for fixing the four recurring flakiness patterns observed in CI for the `cline/` repository.

 It is written to be handed directly to a development team. It explains:

 - what is failing,
- why we believe it is flaky rather than a single deterministic regression,
 - what architectural direction we want to take to stabilize CI,
 - exactly what files and behaviors need to change,
 - how to verify that each change actually improves reliability.

 This document is intentionally detailed. A developer should be able to use it without needing to review the original investigation thread.

---

 ## Executive summary

 We observed four distinct categories of CI flakiness in GitHub Actions run `24509754838` and its reruns. The failures were isolated to the Windows test matrix job until the final rerun succeeded, which strongly suggests intermittent timing, environment, and network sensitivity rather than a single permanent code break.

 The four flake classes are:

 1. **CLI Ink test timing flake** in `SkillsPanelContent.test.tsx`
 2. **BannerService fake-timer / background async flake** in `BannerService.test.ts`
 3. **Hook process timeout flake** in `hook-factory.test.ts`
 4. **VS Code test runtime download / resolution flake** in extension integration tests (`vscode-test` / `@vscode/test-electron`)

 The overall vision is:

 - remove fixed-sleep assumptions from tests,
 - make timer-driven tests explicitly wait for real state transitions,
 - give Windows process-heavy tests realistic timeout budgets,
 - and remove unnecessary live network dependency from CI setup.

 In short: **we want CI to be deterministic, explicit, and environment-resilient**.

---

 ## Background and problem statement

 The investigation of GitHub Actions reruns found the following sequence:

 - **Attempt 1** failed in CLI tests
 - **Attempts 2 and 3** failed in unit tests due to BannerService timing issues
 - **Attempts 3, 4, and 5** failed in extension integration setup due to `@vscode/test-electron` timeout during version resolution/download
 - **Attempt 5** also showed a hook-system timeout in a Windows hook execution test
 - **Attempt 6** passed completely

 Since the final rerun passed without code changes, the failures are best understood as **flaky interactions between tests, asynchronous state, Windows process overhead, and network-sensitive test setup**.

 We should therefore treat this as a CI stabilization initiative, not as a single bugfix.

---

 ## Architectural vision

 ### The end state we want

 We want a test suite where:

 - tests wait for **observable readiness**, not arbitrary time,
 - timer-based tests explicitly control and flush the async work they trigger,
 - process-spawning tests account for platform-specific startup cost,
 - CI setup does not depend on an avoidable live network request at the moment a test begins,
 - failures are more likely to indicate a real regression than a scheduling accident.

 ### The reliability patterns we want to adopt

 #### Pattern 1: Wait for state, not time

 A fixed delay like `await delay(60)` assumes the system will become ready within a guessed duration. This is fragile because the duration changes across machines, OSes, runners, and load conditions.

 Instead, tests should wait for evidence such as:

 - a rendered frame containing expected text,
 - a mock call count reaching an expected value,
 - a promise representing in-flight background work completing,
 - a visible loading state disappearing.

 #### Pattern 2: Treat background work as a first-class test concern

 Tests that indirectly trigger work in the background should not assume that a single event-loop tick is enough to settle the system. If code starts background fetches, debounced tasks, timeout-based retries, or abort timers, the tests need dedicated helpers to flush or await those states.

 #### Pattern 3: Budget for Windows where process startup is part of the test

 Hook and CLI integration tests that spawn real processes on Windows incur non-trivial startup overhead. If a test is correct but too aggressively timed, the right fix is often to adjust the timeout budget for Windows rather than misdiagnose the implementation.

 #### Pattern 4: Move network-sensitive setup out of the critical test path

 If a test step begins by downloading or resolving a runtime over the network, the entire test result becomes vulnerable to transient network failures. Where possible, CI should prefetch, pin, and cache those artifacts.

---

 ## Scope

 This plan covers four specific flake classes:

 1. `cli/src/components/SkillsPanelContent.test.tsx`
 2. `src/services/banner/__tests__/BannerService.test.ts`
 3. `src/core/hooks/__tests__/hook-factory.test.ts`
 4. `.vscode-test.mjs` and `.github/workflows/test.yml`

 This plan does **not** attempt a broad refactor of unrelated tests or CI systems beyond what is necessary to stabilize these known flakes.

---

## Success criteria

This effort should be considered successful when the repository reaches the following state:

- All four known flake classes are addressed by explicit code, test, or workflow changes inside this repository.
- The previously failing tests no longer depend on guessed timing where a more explicit readiness signal exists.
- Timer-heavy tests behave deterministically under fake timers on both Windows and non-Windows environments.
- Windows hook tests have timeout budgets that match the actual cost of launching real hook processes.
- Extension integration test setup is no longer dependent on resolving the latest VS Code runtime from the network during the critical test step.
- The resulting code is understandable enough that a future maintainer can tell why these stabilizations exist and when they should or should not be changed.

This section is intentionally phrased as end-state criteria rather than a checkbox list. It is meant to define the quality bar, not act as bookkeeping.

---

 ## Workstream 1: Stabilize `SkillsPanelContent` CLI tests

 ### Problem summary

 The failing test in `cli/src/components/SkillsPanelContent.test.tsx` expects Enter to call `onUseSkill` immediately after render, but the component loads its skills asynchronously in a `useEffect` via `refreshSkills(controller)`.

 On a fast machine this may work with a short sleep. On Windows CI it can race.

 ### Intended fix

 Replace sleep-based timing assumptions with readiness-based waiting.

At a deeper architectural level, the goal here is to make the test describe the real contract of the component. The component contract is not "the UI will be ready in 60ms." The real contract is "once skills have loaded and are visible/selectable, pressing Enter should use the selected skill." The tests should encode that real contract directly.

 ### Files involved

 - `cli/src/components/SkillsPanelContent.test.tsx`
 - optionally `cli/src/components/SkillsPanelContent.tsx`

 ### Implementation checklist

- [x] Review all tests in `SkillsPanelContent.test.tsx` that currently use `delay()` after render or input
- [x] Add a reusable helper such as `waitForCondition` or `waitForFrameContent`
- [x] Make the Enter-key test wait until the skill is actually rendered before sending input
- [x] Make post-input assertions wait on mock calls rather than a fixed delay
- [x] Update the other navigation/toggle tests in the file to use the same pattern for consistency
- [x] Decide whether to retain `delay()` only as an internal polling primitive or remove it entirely
 - [ ] Optionally prevent input handling while `isLoading` is true inside the component

 ### Detailed developer instructions

 #### 1. Add a polling helper in the test file

 Create a helper near the existing `delay()` function that repeatedly checks a condition until it is true or a timeout is reached.

This helper is important because Ink-based UI tests often involve a small amount of asynchronous work between render, state update, and observable output. On one machine that work may appear to finish immediately; on another it may lag slightly because of CPU scheduling, Node event loop timing, or platform-specific terminal behavior. A polling helper converts that variability into an explicit "wait until the component is actually ready" step.

 Example goals for the helper:

 - poll every 10–25ms,
 - fail with a clear message if readiness never arrives,
 - be generic enough to use with rendered text or mock call counts.

 Example behavior:

 - render component,
 - wait until `lastFrame()` includes `test-skill`,
 - then send Enter,
 - then wait until `mockOnUseSkill` has at least one call.

 #### 2. Update the specific flaky test

 Replace this sequence conceptually:

 - render
 - `await delay()`
 - write Enter
 - `await delay()`
 - assert call happened

 with:

 - render and keep `lastFrame`
 - wait until the loaded skill is present in the frame
 - send Enter
 - wait until `mockOnUseSkill` is called
 - assert the exact argument

 #### 3. Update sibling tests in the same file

 Apply the same pattern to:

 - toggle-by-space tests,
 - navigation tests,
 - marketplace-enter tests,
 - wrap-around behavior tests.

 The goal is not just to fix one flaky test, but to remove the same brittle pattern from the whole file.

 #### 4. Optional component hardening

 In `cli/src/components/SkillsPanelContent.tsx`, consider ignoring user input while `isLoading` is true.

 Why this helps:

 - it makes component behavior explicit,
 - it prevents accidental pre-load interaction,
 - it better matches user expectations.

 This is optional because the main issue appears to be test timing, but it is good defensive design.

In plain language: if the screen is still loading its list of skills, the safest thing is often to ignore key presses rather than pretending a selection already exists. That makes the user-facing behavior clearer and makes the test setup easier to reason about.

 ### Verification checklist

 - [ ] Run the CLI test file locally multiple times
 - [ ] Run it specifically on Windows if available
 - [ ] Confirm the test no longer relies on fixed 60ms assumptions
 - [ ] Confirm no false positives were introduced by over-broad polling

Current implementation note:

- The CLI `SkillsPanelContent` tests have been refactored to use readiness-based polling helpers instead of fixed render/input sleeps.
- The targeted CLI package test run passed locally via:
  - `npm --prefix /Users/evekillaby/dev/github.com/cline/cline/cli run test:run -- src/components/SkillsPanelContent.test.tsx`
- This workstream now has local verification in the package-native test harness.

---

 ## Workstream 2: Stabilize BannerService timer-driven tests

 ### Problem summary

 The BannerService tests are timing-sensitive because the service combines:

 - background fetches started indirectly from `getActiveBanners()`,
 - debounce behavior in `onAuthUpdate()`,
 - abort timeout behavior in `doFetch()`,
 - mocked async auth token lookup,
 - fake timers.

 The current tests often assume `await clock.tickAsync(0)` is enough to settle everything. It is not consistently enough on Windows CI.

 ### Intended fix

 Make the tests explicitly wait for the real background work they trigger, and harden BannerService cleanup so one test cannot leave pending state behind for the next.

This workstream is the most architectural of the four. The problem is not just that a test is "too fast." The deeper issue is that the service under test has several overlapping asynchronous mechanisms:

- cached background fetches,
- debounce-based auth updates,
- request timeout cancellation,
- and retry/backoff behavior.

Each of those behaviors is valid in production. The instability appears because the tests are not fully synchronized with those behaviors. In other words, the tests are making weaker promises than the implementation requires.

 ### Files involved

 - `src/services/banner/__tests__/BannerService.test.ts`
 - `src/services/banner/BannerService.ts`

 ### Implementation checklist

 - [ ] Add test helpers for draining background BannerService work
 - [ ] Use those helpers in the flaky cache/429/auth-update tests
 - [ ] Improve fake-timer setup to avoid native/fake timer mismatch
 - [ ] Harden `BannerService.reset()` so pending debounce state is fully cleared
 - [ ] Review whether other BannerService tests use the same brittle pattern and convert them if needed

 ### Detailed developer instructions

 #### 1. Add a helper to flush background BannerService work

 In the test file, create a helper that does more than a single zero-tick.

 The helper should aim to:

 - advance fake timers,
 - await any in-flight fetch promise or debounced work,
 - then advance again for trailing microtasks.

 Because `BannerService` starts work in the background, the test must explicitly wait for that internal work before asserting.

 A pragmatic testing approach is acceptable here even if it touches internal state via casting in the test, because the goal is deterministic tests.

This is an example of an important testing principle: if production code intentionally performs work off to the side, the test needs a way to say "I know you started something; now prove to me that it finished." Without that step, the test is really only checking whether the background work *might* have finished quickly enough on this machine.

 #### 2. Update `should fall back to 24 hours when payload is invalid`

 Replace every `tickAsync(0)`-only assumption with the new helper.

 The important checkpoints are:

 - after first cache-populating fetch,
 - after advancing nearly to cache expiry,
 - after advancing beyond cache expiry and triggering another fetch.

 The assertion should always happen after the background work is fully settled.

 #### 3. Update `should trigger backoff on 429 response and return cached banners during backoff`

 This test is especially sensitive because it combines:

 - cached state,
 - cache expiry,
 - a new fetch attempt,
 - a 429 response,
 - post-error backoff behavior.

 Use the helper after:

 - initial success fetch,
 - the 429-triggering call.

 Make sure the test verifies both:

 - cached banners are still returned,
 - no extra unexpected fetch occurs during backoff.

 #### 4. Update `should clear pending retry timeout on auth update`

 This test is the most timing-complex because it adds:

 - rate-limit backoff,
 - auth update debounce,
 - cancellation of prior pending behavior.

 Use explicit helper-based synchronization after:

 - initial success fetch,
 - 429-triggering fetch,
 - auth update debounce completion.

 Then verify the old scheduled retry does not fire after a long future tick.

 #### 5. Use safer fake-timer configuration

 Where tests currently do:

 ```ts
 const clock = sandbox.useFakeTimers(Date.now())
 ```

 change to an options form that is more resilient when clearing timers created across async boundaries.

 The objective is to reduce native/fake timer mismatch, which was hinted at by the CI warning:

 - `FakeTimers: clearTimeout was invoked to clear a native timer instead of one created by this library`

That warning matters because fake timers only control the timers they create or intercept. If part of the system is still holding onto native timers while the test assumes everything is fake and controllable, then the test can enter a half-real, half-simulated state. That is exactly the kind of condition that often passes locally and flakes in CI.

 #### 6. Harden `BannerService.reset()`

 Update `src/services/banner/BannerService.ts` so `reset()` fully clears pending state, not just the visible timeout and abort controller.

 It should clear or resolve:

 - `debounceTimer`
 - `pendingDebounceResolve`
 - `abortController`
 - `fetchPromise`
 - `authFetchPending`

 Why this matters:

 - one test may schedule debounce work,
 - another test may start with leftover pending state,
 - CI flakiness can emerge from that hidden cross-test contamination.

This is not just cleanup for neatness. It is an architectural containment step. Good test cleanup ensures each test starts from a true blank slate rather than inheriting invisible scheduled work from a previous test.

 #### 7. Review for similar patterns elsewhere in the same file

 Several other BannerService tests currently use tiny waits like:

 - `await clock.tickAsync(0)`
 - `await new Promise((resolve) => setTimeout(resolve, 10))`

 Not all must be changed immediately, but if they follow the same async pattern they should be normalized to the same helper strategy.

 ### Verification checklist

 - [ ] Run BannerService tests repeatedly locally
 - [ ] Run them with Windows if possible
 - [ ] Confirm no test times out while waiting on fake timers
 - [ ] Confirm `reset()` leaves no pending state between tests
 - [ ] Confirm behavior assertions still match intended product semantics, not just timing behavior

---

 ## Workstream 3: Stabilize Windows hook cwd test timing

 ### Problem summary

 The hook test failure was a timeout, not an assertion mismatch. The implementation for determining hook cwd appears reasonable, but the test that executes a global hook from the primary workspace root does not grant extra Windows timeout budget, even though a nearby similar test does.

 ### Intended fix

 Adjust the test timeout policy for the global-hook cwd test to match the already-established Windows behavior used by similar hook tests.

The key design principle here is to distinguish between a correctness problem and a budget problem. A correctness problem means the code is doing the wrong thing. A budget problem means the code is doing the right thing but the test is not allowing enough time for the platform-specific cost of doing it. The available evidence points to a budget problem.

 ### Files involved

 - `src/core/hooks/__tests__/hook-factory.test.ts`

 ### Implementation checklist

- [x] Update the global-hook cwd test to use function syntax and set Windows timeout explicitly
- [x] Compare the timeout pattern with the nearby workspace-hook cwd test and keep them aligned
 - [ ] Optionally extract a shared helper or convention comment for future hook tests

 ### Detailed developer instructions

 #### 1. Update the test signature

 Change the global-hook cwd test to use `async function ()` instead of an arrow function so Mocha timeout can be set per test.

 #### 2. Add Windows timeout handling

 Mirror the existing pattern already used elsewhere in the file:

 - if `process.platform === "win32"`
 - set `this.timeout(WINDOWS_HOOK_TEST_TIMEOUT_MS)`

 This is the lowest-risk, highest-confidence change.

 #### 3. Keep the assertion exactly as-is

 The current assertion checks that the hook runs from the primary workspace root by comparing normalized real paths. That is still the correct behavioral assertion.

 We are not weakening correctness; we are only giving the Windows process launch path enough time to complete.

 #### 4. Do not change hook cwd logic unless new evidence appears

 The `determineHookCwd()` logic in `src/core/hooks/hook-factory.ts` currently does this:

 - global hooks use `primaryCwd`
 - workspace hooks use their owning workspace root
 - fallback is `primaryCwd`

 Since the observed CI symptom was timeout-only, not wrong path resolution, we should not change product logic yet.

This restraint is important. When a test flakes, it is tempting to modify the product code simply because it is nearby. But changing correct product logic to satisfy an under-budgeted test can easily introduce real regressions. The right first move is to fix the test harness when the evidence says the harness is the problem.

 ### Verification checklist

 - [ ] Run the hook test file repeatedly
 - [ ] Run on Windows if possible
 - [ ] Confirm the test still asserts the same cwd behavior
 - [ ] Confirm timeout failures disappear without masking genuine assertion failures

Current implementation note:

- The Windows timeout-budget code change for the global-hook cwd test has been made.
- Targeted local verification is currently blocked by unrelated pre-existing repository test execution issues:
  - direct TypeScript/Mocha invocation is currently tripping path-resolution problems in the unit-test harness,
  - and the compiled test flow is currently blocked by unrelated TypeScript build failures in `updateSettings*` / `shell.ts`.
- Because those failures are outside the scope of the hook-timeout change, this workstream should be treated as **implemented but awaiting full repo-level test verification once the unrelated test/build blockers are cleared**.

---

 ## Workstream 4: Remove network sensitivity from extension integration setup

 ### Problem summary

 The extension integration failures do not appear to be failures in extension logic. They fail before the tests run, during `vscode-test` runtime resolution:

 - `Resolving version...`
 - `Error: @vscode/test-electron request timeout out after 15000ms`

 This means CI is relying on a live network-dependent version resolution/download step inside the test execution path.

 ### Intended fix

 Make extension integration setup reproducible and cacheable by pinning the VS Code runtime version and caching the downloaded artifact in CI.

This workstream is best understood as separating "testing the extension" from "downloading the machinery needed to test the extension." Right now those two concerns are coupled too tightly. That coupling means an upstream timeout or transient network issue can look like an extension regression even when the extension itself is fine.

 ### Files involved

 - `.vscode-test.mjs`
 - `.github/workflows/test.yml`

 ### Implementation checklist

 - [ ] Choose and pin a specific VS Code test runtime version in `.vscode-test.mjs`
 - [ ] Verify where `@vscode/test-cli` / `@vscode/test-electron` stores downloaded VS Code artifacts in CI
 - [ ] Add cache step(s) in `.github/workflows/test.yml` keyed by OS + pinned version
 - [ ] Add a narrow retry around the Windows extension integration step
 - [ ] Optionally prefetch the runtime in a dedicated setup step before running integration tests
 - [ ] Document why the version is pinned so future changes do not revert to `stable`

 ### Detailed developer instructions

 #### 1. Pin the VS Code version

 In `.vscode-test.mjs`, replace:

 ```ts
 version: "stable"
 ```

 with a concrete version string.

 Why this matters:

 - `stable` forces runtime resolution against the current remote state,
 - a pinned version is reproducible,
 - a pinned version can be safely cached,
 - a pinned version reduces surprise when upstream stable changes.

For a layperson: using `stable` is a little like telling CI to "go get whatever the newest version is right now." That sounds convenient, but it makes the test environment change underneath us. Pinning the version means we are testing against a known toolchain instead of a moving target.

 #### 2. Determine the runtime cache path

 Before editing the workflow, confirm where the downloaded VS Code test runtime is stored during CI. Use local reproduction or library docs if necessary.

 Candidate locations may include hidden `.vscode-test`-style directories.

 The workflow cache should target the actual runtime storage location, not just a guessed directory.

 #### 3. Add CI caching

 In `.github/workflows/test.yml`, add a cache step before the Windows integration test step.

 The cache key should include:

 - OS
 - pinned VS Code version
 - possibly a manual cache schema/version prefix

 Example conceptual key:

 - `vscode-test-runtime-windows-<pinned-version>`

Caching is important because it changes the problem from "download this every time and hope the network cooperates" into "reuse the exact same previously downloaded artifact whenever possible." That directly reduces an entire class of nondeterministic failures.

 #### 4. Add targeted retry for the integration step

 Wrap only the Windows `npm run test:integration` step in a retry mechanism.

 This should not be applied to unrelated steps.

 Why this is acceptable here:

 - the failure mode is external setup/network sensitivity,
 - retries are appropriate for transient download/setup errors,
 - retries are less appropriate for real unit/integration assertion failures.

 #### 5. Consider prefetching the runtime separately

 If pinning + caching still leaves occasional failures, split setup into two steps:

 1. fetch/prepare VS Code test runtime
 2. run `npm run test:integration`

 This keeps network-sensitive work out of the test execution step and makes failures easier to classify.

 #### 6. Avoid the wrong fix

 Do **not** rely on raising Mocha timeout in `.vscode-test.mjs` as the main fix.

 Why:

 - the failure occurs in `@vscode/test-electron` request resolution before the actual extension test logic begins,
 - Mocha timeout controls test duration, not the runtime-resolution request timeout.

 ### Verification checklist

 - [ ] Confirm `.vscode-test.mjs` uses a pinned version
 - [ ] Confirm the CI cache path is correct and receives hits on reruns
 - [ ] Confirm Windows integration steps no longer fail at `Resolving version...`
 - [ ] Confirm a clean-cache run still succeeds reliably
 - [ ] Confirm retries are limited to the setup-sensitive integration step

---

## Cross-cutting cleanup and consistency work

These items are not separate projects; they are implementation quality guidelines that should be applied while doing the main workstreams.

### Test reliability utility cleanup

Where a file contains several tests with the same fragile timing pattern, normalize the whole file rather than patching only the currently failing example. This reduces the chance that the next rerun simply fails in a sibling test that still uses the old pattern.

### Documentation and maintainability

Where a stabilization might otherwise look arbitrary, add a short local explanation in code. Examples include:

- why a Windows-specific timeout exists,
- why a test waits for a rendered condition instead of sleeping,
- why the VS Code version is pinned instead of using `stable`.

These comments matter because future maintainers often remove code they do not understand. A one-line explanation can prevent a later "cleanup" from reintroducing the flake.

---

 ## Suggested implementation order

 This order prioritizes high-confidence, low-risk fixes first.

 ### Phase 1: quick test stabilizers

- Add Windows timeout handling to the global-hook cwd test
- Replace fixed sleeps in `SkillsPanelContent.test.tsx` with readiness-based waiting

 ### Phase 2: CI environment hardening

- Pin VS Code test runtime version in `.vscode-test.mjs`
- Add cache support in `.github/workflows/test.yml`
- Add targeted retry to Windows extension integration step

 ### Phase 3: timer-race cleanup

- Add BannerService async-drain helpers in tests
- Convert flaky BannerService tests to explicit synchronization
- Harden `BannerService.reset()` cleanup

 ### Phase 4: validation and follow-through

- Run targeted local verification for each workstream
- Review the first stabilized CI runs for any remaining symptoms
- Clean up any remaining brittle wait patterns found during implementation

---

## Developer verification matrix

The verification goals below are written as concrete outcomes rather than bookkeeping checklists. They describe what a developer should prove before considering each workstream complete.

### SkillsPanelContent

The single-file test run should pass repeatedly, the broader CLI suite should continue to pass, and no important assertion in this file should still depend on an arbitrary render/input sleep where readiness could be observed directly.

### BannerService

The targeted flaky tests should pass repeatedly under fake timers, the timer configuration should no longer emit suspicious native/fake timer mismatch behavior during the flaky scenarios, and cleanup should leave no evidence of cross-test contamination.

### Hook system

The global-hook cwd test should pass on Windows with the increased timeout budget, the workspace-hook cwd behavior should remain unchanged, and no product-code change should be necessary unless a real cwd assertion failure later appears.

### Extension integration

The pinned VS Code runtime should be used in CI, runtime caching should work as intended, and Windows should stop failing at the `Resolving version...` stage. If failures remain, they should be more clearly attributable to real integration behavior rather than setup-time download instability.

---

 ## Risks and how to avoid them

 ### Risk 1: Hiding real bugs with looser timing

 Mitigation:

 - do not merely increase timeouts for all tests,
 - first prefer readiness-based waiting or explicit async flushing,
 - only increase timeout where real process startup is inherently variable.

 ### Risk 2: Overfitting tests to implementation internals

 Mitigation:

 - keep helper abstractions focused on externally meaningful states when possible,
 - only reach into internal promises where background work has no better public completion signal.

 ### Risk 3: CI cache misconfiguration

 Mitigation:

 - verify the actual runtime download directory before finalizing workflow cache paths,
 - include version in the cache key,
 - test both cold-cache and warm-cache runs.

 ### Risk 4: Fixing one flaky test while leaving sibling tests brittle

 Mitigation:

 - when a file shows a shared anti-pattern, normalize the whole file rather than patching only the currently failing case.

---

## Definition of done

This initiative is done when the four identified flake classes have concrete repo-local fixes merged, the tests and workflow reflect the deterministic design principles described in this document, and the resulting code is documented clearly enough that future contributors understand both what was changed and why it needed to work that way.

---

 ## Appendix: concise mapping from flake to fix direction

 ### Flake 1: `SkillsPanelContent` Enter-key test

 **Observed symptom:** mock callback not called on Windows CI.

 **Root cause direction:** Enter races against async-loaded component state.

 **Fix direction:** replace fixed sleeps with readiness-based waiting; optionally ignore input during loading.

 ### Flake 2: BannerService tests timing out

 **Observed symptom:** fake-timer tests time out in cache/backoff/auth-update cases.

 **Root cause direction:** background fetch + debounce + fake timer coordination is under-specified.

 **Fix direction:** explicit helper-based flushing of async work; better cleanup in `reset()`.

 ### Flake 3: Global hook cwd test timeout

 **Observed symptom:** Windows timeout with no assertion mismatch.

 **Root cause direction:** Windows process startup overhead exceeds default per-test budget.

 **Fix direction:** add Windows-specific timeout handling to match sibling hook tests.

 ### Flake 4: `@vscode/test-electron` request timeout

 **Observed symptom:** fails during `Resolving version...` before extension tests run.

 **Root cause direction:** network-sensitive runtime resolution/download inside the critical test path.

 **Fix direction:** pin version, cache runtime, retry setup-sensitive step, optionally prefetch runtime.