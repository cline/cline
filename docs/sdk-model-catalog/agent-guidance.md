# Agent Guidance for SDK Model Catalog Work

Succinct steering notes for future teammate/subagent runs on this project.

## Shared prompt rules

- Give agents a **tiny scoped task** with an explicit file list and explicit non-goals.
- Say **do not inspect unrelated git history/stashes** unless the task is git-specific. Agents can burn iterations on repository hygiene instead of implementation.
- Say **do not run install commands** and **do not modify `package-lock.json`** unless dependency changes are the task.
- Tell agents the exact validation command, but also tell them to report pre-existing/environmental failures separately from failures in touched files.
- For Phase 0/1 work, include these constraints verbatim:
  - Do not edit `contracts.ts` unless the task explicitly says so.
  - No real SDK imports until the phase that calls for SDK integration.
  - `ProviderCatalog` accepts `ProviderConfigReader`, not `ProviderConfigStore`.
  - No selection writes outside `commitSelection`.
  - Casts to branded types are allowed only in parse/compute boundary functions.
- Prefer prompts with **expected shapes** over prompts that only reference docs. The docs are useful context; exact expected exports prevent wandering.
- Ask agents to **stop after validation**. Do not ask them to summarize extensively if the goal is code output.

## Current agent setup

Use **GPT-5.5 + Opus 4.7** as the default two-head implementation team.

- **GPT-5.5** has been the most reliable implementation horse when the prompt gives exact files, expected exports, and validation commands.
- **Opus 4.7** is most useful for architectural critique, invariants, comments, and test ideas. Keep tasks especially narrow; it can burn iterations on context-gathering if the prompt is too broad.
- Do not dispatch weaker/less predictable models such as DeepSeek, Kimi, or Gemini for this migration unless the goal is explicitly a low-stakes experiment. Keeping the team to the two strong heads reduces cleanup and stale worktree noise.

## Historical model observations

These notes explain why the current setup is GPT-5.5 + Opus 4.7. They are not recommendations to keep using the other models.

### Phase 0.3 skeleton-module experiment

### OpenAI GPT-5.5 (`cline/openai/gpt-5.5`)

- First pass succeeded quickly and compiled cleanly.
- Needed more explicit expected-shape constraints: initial output missed trim/lowercase in `parseProviderId`, returned `boolean` instead of a type predicate, and used a global fingerprint placeholder.
- Good for straightforward implementation when prompt is concrete.

### Claude Opus 4.7 (`cline/anthropic/claude-opus-4.7`)

- First attempt wandered into git/stash confusion and exhausted iterations.
- Retry with a shorter prompt and explicit "do not inspect stashes / do not run install" produced the best architectural output.
- Strong at docstrings, invariants, narrow public API, and preserving boundaries.
- Needs iteration cap breathing room; use a small task and a direct prompt.

- DeepSeek V4 Pro and Kimi K2.6 both required extra cleanup/guardrails in this experiment. They are no longer part of the recommended team for this work.

## Model observations from Phase 0.2 safe-defaults rename

Task: rename `*ModelInfoSaneDefaults` identifiers to `*ModelInfoSafeDefaults`, with grep proving no `SaneDefaults` identifiers remain.

- **GPT-5.5** completed quickly and produced a broad correct rename. Good for straightforward repo-wide symbol changes.
- **Opus 4.7** correctly noticed that the exit criterion was broader than the step title: not only `openAiModelInfoSaneDefaults`, but all `*ModelInfoSaneDefaults` identifiers had to be renamed. Best reasoning about specification nuance.
- DeepSeek V4 Pro and Kimi K2.6 were less reliable in this round. This reinforced the decision to stick with GPT-5.5 + Opus 4.7.

Prompt adjustment for future rename/refactor tasks:

```text
Validation must include these exact commands and their outputs:
- git status --short
- git diff --stat
- grep -rn "<old-pattern>" <paths> || true
- grep -rn "<new-pattern>" <paths> | wc -l
```

## Model observations from Phase 1.1 / 1.2 implementation rounds

### Phase 1.1 — provider id parsing

- **GPT-5.5** produced the best compact implementation pattern: `KNOWN_API_PROVIDERS satisfies Record<ApiProvider, true>` gives a useful exhaustiveness check while keeping code small.
- **Opus 4.7** produced the best tests and comments, but its compile-time provider-list check was only one-directional. Mine Opus for test cases and invariant language; verify type-level claims before accepting.
- DeepSeek V4 Pro violated the branded-cast boundary in tests. Do not use it for this migration unless explicitly re-evaluating models.

### Phase 1.2 — config fingerprinting

- **GPT-5.5** and **Opus 4.7** both produced usable implementations. GPT returned a full versioned sha256 fingerprint (`config:v1:<64 hex>`), while Opus had stronger explanatory comments but shortened the final fingerprint to 12 hex chars. For cache identity, prefer the full hash.
- **GPT-5.1-Codex-Max** produced a solid implementation but used branded casts in tests; prompts should explicitly forbid casts in test files too.
- Gemini 3.1 Pro Preview reported success but left no diff in its worktree. It is no longer part of the recommended team.

Fingerprint-round prompt adjustment:

```text
The final fingerprint should be versioned and full-length, e.g. `config:v1:<64 hex>`.
Short hashes are acceptable only for secret subcomponents inside the payload.
No `as ProviderId` / `as Fingerprint` casts in tests.
Final response must include literal `git status --short` and `git diff --stat` output.
```

### Phase 1.2 hardening — sanitized fingerprint payloads

- **GPT-5.5** completed quickly and correctly. Good for small hardening patches.
- **Opus 4.7** again produced the most useful comments and test coverage, and was selected as the base for the lead branch.
- **GPT-5.1-Codex-Max** produced a viable implementation, but with less coverage around nested extras / array behavior than Opus.
- Gemini 3.1 Pro Preview exceeded max iterations and left no diff again. It is no longer part of the recommended team.

For future security/sanitization work, explicitly state whether internal payloads may contain sensitive values. If the result crosses RPC/logging boundaries, keep final fingerprints opaque and versioned; only expose sanitized subcomponents to internal helpers/tests.

## Recommended next-round setup

- For implementation tasks: run **GPT-5.5 + Opus 4.7** as the main two heads.
- Prefer improving prompt scope over adding more models. The current pattern is two clean branches, two strong heads, then lead synthesis.
- Always prepare a clean branch/worktree first; verify `git status -sb` is clean before dispatch.
- Keep previous unrelated work in stashes with explicit messages before reusing worktrees.

## Good task-template skeleton

```text
Worktree: <absolute path>
Branch: <branch name>

Task: <one phase/step only>.

Create/modify exactly these files:
- ...

Rules:
- Do not edit <protected files>.
- Do not edit docs unless instructed.
- Do not edit package-lock.json.
- Do not run npm install or git stash.
- Do not commit.

Expected shape:
- <function/file-level expectations>

Validation:
- Run <command>.
- Report changed files and whether validation failed due to touched files or pre-existing environment issues.
```
