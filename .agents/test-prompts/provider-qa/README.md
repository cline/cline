# Provider QA prompt pack

Eight independent manual-QA prompts covering LLM provider configuration in Cline. Each numbered file is a
**complete, standalone prompt**: hand the whole file to one agent (or one human tester) and it has everything it
needs — setup commands, click paths, pass/fail criteria, and the artifacts to produce. Nothing in a prompt depends
on another prompt having been run first.

They are split this way because these areas fail for different reasons, need different credentials, and produce
different evidence. Running them as one giant pass buries findings and makes the video unwatchable.

| # | Prompt | What it catches | Needs real keys? |
|---|--------|-----------------|------------------|
| 01 | [Legacy config migration](./01-legacy-config-migration.md) | Upgrades that silently drop a key, a model, or a mode | No (optional) |
| 02 | [Provider config options](./02-provider-config-options.md) | Settings that persist in the UI but never reach the wire | No |
| 03 | [Cold setup + first message](./03-cold-setup-first-message.md) | Providers that cannot be set up from scratch | Yes |
| 04 | [Selection persistence across reload](./04-persistence-across-reload.md) | The silent reset-to-a-different-provider bug class | Partial |
| 05 | [Tool calling per provider](./05-tool-calling-per-provider.md) | Double-fired tools, mangled args, Responses-API drift | Yes |
| 06 | [Model dropdown behaviour](./06-model-dropdown-behavior.md) | Empty live model lists, custom model ids that don't stick | Partial |
| 07 | [Token + cost accounting](./07-token-and-cost-accounting.md) | $0.00, absurd costs, missing cache tokens | Yes |
| 08 | [Error paths](./08-error-paths.md) | Raw stacks, silent hangs, unactionable errors | Partial |

"Partial" means the prompt gets most of its coverage from the local fixtures below and only needs a live key for a
few named steps.

## Fixtures

Two helpers live in [`fixtures/`](./fixtures) and are shared by several prompts.

### `fixtures/seed-legacy-config.mjs`

Writes a pre-migration `globalState.json` + `secrets.json` pair into a data directory, deliberately leaving
`settings/providers.json` absent so the real migration in
`sdk/packages/core/src/services/storage/provider-settings-legacy-migration.ts` has to run.

```bash
node .agents/test-prompts/provider-qa/fixtures/seed-legacy-config.mjs --list
node .agents/test-prompts/provider-qa/fixtures/seed-legacy-config.mjs \
  --shape split-plan-act --dir /tmp/cline-qa/data --force
```

### `fixtures/fault-proxy.mjs`

An OpenAI-compatible endpoint whose behaviour is chosen by the model id, so a tester reproduces a rate limit or a
mangled tool call by picking `fault/429` or `fault/tool-mangled-args` in the model dropdown instead of waiting for a
real provider to misbehave. It also logs every inbound request, which is how prompt 02 proves a provider setting
actually reached the wire.

```bash
node .agents/test-prompts/provider-qa/fixtures/fault-proxy.mjs   # http://127.0.0.1:8788/v1
```

Configure it in the UI as **OpenAI Compatible**, base URL `http://127.0.0.1:8788/v1`, any non-empty API key.

### `fixtures/run-migration.ts`

Triggers the legacy migration headlessly and prints the resulting `providers.json`, for a fast pre-check before
spending time in the UI. Needs the SDK built (`bun run build:sdk`):

```bash
bun .agents/test-prompts/provider-qa/fixtures/run-migration.ts /tmp/cline-qa/data
```

## Reaching the provider settings

Every prompt launches its own VS Code with the extension in development mode. The click path, confirmed by running
prompt 08 end to end:

Cline icon in the Activity Bar → onboarding (only on an empty data directory) → **Bring my own API key** →
**Continue** → the provider form. Afterwards the same form is behind the gear icon in the Cline navbar, and
**Done** closes it. The provider field is labelled *API Provider* with the placeholder *Search and select
provider…*.

Launch with `--disable-workspace-trust`; without it VS Code opens in Restricted Mode and the prompts that execute
commands will be blocked by a trust banner rather than by a real bug.

## What the pack has already found

Two findings came out of building and dry-running these prompts, and both are written up in place with a
reproduction:

- **Migration drops a per-mode model id.** With plan and act on different providers, `migrateLegacyProviderSettings`
  reads a single `mode` from `globalState.mode` and applies it to every candidate provider, so the other mode's
  model id is never read and the provider silently lands on a catalog default. Repro in
  [prompt 01](./01-legacy-config-migration.md).
- **The Model ID autocomplete commits the wrong model on a prefix match.** Typing `fault/ok` commits
  `fault/ok-no-cache`. Repro in [prompt 06](./06-model-dropdown-behavior.md).

## Conventions every prompt follows

- **Isolated state.** Each run gets its own `CLINE_DATA_DIR` and its own VS Code `--user-data-dir`, so a run can
  never inherit or corrupt another run's provider config. This matters more than usual here: half the bug class
  being hunted is "stale state leaks into a fresh session".
- **Verify on the wire, not in the widget.** A dropdown showing the right model proves nothing. Every persistence
  and configuration check ends with an actual request whose destination and payload were observed.
- **One video per prompt, minimum.** Recording starts immediately before the interesting interaction, not during
  setup.
- **Findings are filed with a repro, not a description.** Exact clicks, the on-disk state before and after, and the
  suspected file.
