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

## Model observations from Phase 0.3 experiment

### OpenAI GPT-5.5 (`cline/openai/gpt-5.5`)

- First pass succeeded quickly and compiled cleanly.
- Needed more explicit expected-shape constraints: initial output missed trim/lowercase in `parseProviderId`, returned `boolean` instead of a type predicate, and used a global fingerprint placeholder.
- Good for straightforward implementation when prompt is concrete.

### Claude Opus 4.7 (`cline/anthropic/claude-opus-4.7`)

- First attempt wandered into git/stash confusion and exhausted iterations.
- Retry with a shorter prompt and explicit "do not inspect stashes / do not run install" produced the best architectural output.
- Strong at docstrings, invariants, narrow public API, and preserving boundaries.
- Needs iteration cap breathing room; use a small task and a direct prompt.

### DeepSeek V4 Pro (`cline/deepseek/deepseek-v4-pro`)

- First attempt modified `package-lock.json` and produced no useful files.
- Retry completed successfully when explicitly forbidden from install/lockfile changes.
- Output was pragmatic and mostly correct, but broadened public API more than desired and sometimes assigned future behavior to the wrong phase.
- Good cost/performance if task shape is explicit; needs guardrails against package/dependency churn.

### Kimi K2.6 (`cline/moonshotai/kimi-k2.6`)

- Completed Phase 0.3 successfully with concise code.
- Weaker on repository conventions: used value imports instead of `import type`, broad barrel exports, and thinner comments.
- Useful as a lightweight second opinion, but prompt should explicitly require `import type` and narrow `index.ts` exports.

## Recommended next-round setup

- For implementation tasks: run **GPT-5.5 + Opus 4.7** as the main two heads.
- Add **DeepSeek V4 Pro** when cost matters or when a pragmatic third output is useful.
- Add **Kimi K2.6** for fast alternative sketches, but expect more cleanup around TypeScript conventions.
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
