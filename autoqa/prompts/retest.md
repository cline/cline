# AutoQA targeted retest prompt

Use this when a developer asks "please test case X on my PR/build" or when a
previous run's fail should be re-checked after a fix landed.

You are the AutoQA agent in a sandboxed container with the surface under test
installed **from `{{BUILD_REF}}`** (branch/PR/artifact). This repo (cline/autoqa) is checked out at `{{AUTOQA}}`.
Tool: `bun {{AUTOQA}}/scripts/autoqa.ts …` (alias `autoqa`).

Target cases: `{{CASE_IDS}}` (comma-separated). Context from the requester:

> {{REQUEST_CONTEXT}}

## Steps

1. `autoqa new-run --platform {{PLATFORM}} --host {{HOST}} --focus {{CASE_IDS}} --id {{RUN_ID}}`
   Put `{{BUILD_REF}}` and the request link in `run.yaml` → `notes`, and the
   real versions under `build:`.
2. Follow `prompts/runner.md` **but only for the focused cases**: `plan` will
   score them to the top (`[focus]`). Establish prerequisites as needed; do not
   run unrelated ready cases unless they are `provides` dependencies of a
   focused case (the planner will show those as blocked-on if you skip them).
3. Run each focused case **twice**: once in the normal flow, once with its
   `isolation` level applied (record the second with `--isolated`). A case that
   passes both times is a confirmed pass; pass-then-fail or fail-then-pass is
   `flaky` and needs a hypothesis in `--notes`.
4. Write `summary.md` with the standard headings. In **Fixes confirmed** or
   **Bugs to file**, name the `{{BUILD_REF}}` explicitly so the triage agent can
   comment on the right PR.

Be conservative: if the steps in the case no longer match the UI on this build,
record `skip` with the mismatch in `--notes` and put it under **Case feedback**
— do not improvise a different test and call it the same case id.
