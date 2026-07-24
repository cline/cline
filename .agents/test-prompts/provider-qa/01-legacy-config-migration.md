# QA 01 — Legacy provider config migrates without losing anything

You are testing whether a user who upgrades Cline keeps a working provider setup. The old on-disk format stored
provider credentials in `globalState.json` + `secrets.json`; the current format stores them in
`settings/providers.json`. Migration runs automatically when `ProviderSettingsManager` is constructed, which
happens on extension activation.

The failure mode that matters is **silent** loss: the extension starts, nothing errors, and the user's key, model,
base URL, or per-mode selection is quietly gone or replaced with a default. Assume nothing is preserved until you
have seen it in the UI *and* used it to send a real request.

Owning code, for when you need to trace a finding:

- `sdk/packages/core/src/services/storage/provider-settings-legacy-migration.ts` — the migration itself
- `apps/vscode/src/sdk/provider-migration.ts` — the extension's entry point into it
- `apps/vscode/src/core/storage/state-migrations.ts` — flat keys to `planMode*`/`actMode*` keys
- `apps/vscode/src/hosts/vscode/vscode-to-file-migration.ts` — VS Code memento to `~/.cline/data`

## Setup

```bash
export QA=/tmp/cline-qa/migration
rm -rf "$QA" && mkdir -p "$QA/workspace"
printf 'export const name = "john"\n' > "$QA/workspace/qa.txt"

# Build only if dist/extension.js is missing or older than your checkout
cd /workspace/apps/vscode && bun run build:webview && bun esbuild.mjs
```

Seed a legacy config and launch against it. Re-run these two commands with a different `--shape` for each case
below, killing the previous VS Code window first.

```bash
node /workspace/.agents/test-prompts/provider-qa/fixtures/seed-legacy-config.mjs \
  --shape anthropic --dir "$QA/data" --force

tmux -f /exec-daemon/tmux.portal.conf new-session -d -s vscode-migration -- \
  env DISPLAY=:1 CLINE_DATA_DIR="$QA/data" \
  code --no-sandbox --disable-workspace-trust --user-data-dir="$QA/vscode-userdata" \
       --extensionDevelopmentPath=/workspace/apps/vscode "$QA/workspace"
```

Open the Cline panel with the Cline icon in the VS Code Activity Bar, then the gear icon in the Cline navbar to
reach **API Configuration**; **Done** closes it. If the data directory has no usable config Cline shows onboarding
instead — choose **Bring my own API key**, then **Continue**, which lands on the same provider form. Which of the
two you get is itself a signal here: a successfully migrated config should never drop you into onboarding.

`--shape --list` shows all shapes. Optionally pass `--key <real key>` to any shape so the migrated config can also
send a live request.

For a fast headless pre-check of what migration produced, before opening the UI (needs `bun run build:sdk`):

```bash
bun /workspace/.agents/test-prompts/provider-qa/fixtures/run-migration.ts "$QA/data"
```

## What to test

Run every shape. For each one, the migration is only a pass if all four of these hold.

1. **The UI shows the migrated selection.** API Configuration opens on the provider from the legacy config, with
   the legacy model id selected and the API key field populated and masked. It must not land on the default
   provider, and it must not show an empty model.
2. **`providers.json` matches.** `cat "$QA/data/settings/providers.json"`. The entry exists, carries
   `"tokenSource": "migration"`, and the `apiKey` / `model` / `baseUrl` match what was seeded.
3. **The migrated config actually works.** Send a message. It must reach the provider the legacy config named — not
   merely "not error". If you seeded a placeholder key, an auth error from the correct provider is a pass; an auth
   error naming a *different* provider is a failure.
4. **Nothing else got selected.** With the `many-keys` shape, all nine credentials migrate but the selected provider
   stays `gemini`.

Then the cases that are specifically about migration being re-entrant:

5. **Idempotency.** Close VS Code, relaunch against the same `$QA/data`. `providers.json` must be byte-identical
   apart from nothing at all — no duplicate entries, no bumped `updatedAt`, no reverted values.
6. **Migration never clobbers newer data.** Launch, change the model in the UI to something different, close, and
   relaunch. The legacy files are still on disk, so migration will run again; your UI edit must win. This is the
   worst-case regression: an upgrade that resurrects an old model id every restart.
7. **Partial legacy state.** Hand-edit `globalState.json` to delete the model id key but keep the provider, and
   relaunch with a fresh `providers.json` (`rm "$QA/data/settings/providers.json"`). The provider must still be
   selected with a sane default model, not a blank dropdown or a crash.
8. **Corrupt legacy state.** Write `{` into `globalState.json` and relaunch. Expect the extension to start with an
   unconfigured provider and a readable message — not a broken webview or an activation failure.

## Known finding to confirm and file

This one already reproduces headlessly; confirm it in the UI and file it with the evidence.

```bash
node /workspace/.agents/test-prompts/provider-qa/fixtures/seed-legacy-config.mjs \
  --shape split-plan-act --dir /tmp/cline-qa/split/data --force
bun /workspace/.agents/test-prompts/provider-qa/fixtures/run-migration.ts /tmp/cline-qa/split/data
```

The seeded config is plan = anthropic / `claude-opus-4-1-20250805`, act = openrouter / `z-ai/glm-4.6`, with
`mode: "plan"`. Both providers migrate and both keys survive, but the migrated OpenRouter entry comes out holding
the catalog default model instead of `z-ai/glm-4.6`.

The cause is in `migrateLegacyProviderSettings`: it reads a single `mode` from `globalState.mode` and passes it to
`buildLegacyProviderSettings` for *every* candidate provider, so `resolveModelForProvider` looks up
`planModeOpenRouterModelId` — which was never set — and falls through to `getDefaultModelForProvider`. The act-mode
model id is on disk and is simply not read.

What to establish in the UI: switch to Act mode after migration and record which model the act-mode request
actually uses. Note whether the user is told their model changed. Then decide with the owning team whether the
single-model-per-provider shape of `providers.json` makes this intended, or whether the per-mode key should be
preferred when the mode-matched key is missing.

## Also worth probing

- Legacy `openai` provider id must land as `openai-compatible`, keeping `openAiBaseUrl` and both `openAiHeaders`
  entries. Confirm the headers are in `providers.json`, not just implied.
- `requestTimeoutMs`, `thinkingBudgetTokens`, and `reasoningEffort` should survive; `resolveReasoning` collapses
  mode-specific reasoning fields into one, so check what happens when plan and act disagree.
- The bedrock shape carries no API key at all — access key, secret, session token, region, and the cross-region and
  prompt-cache flags must all arrive.

## Artifacts

- One video: launching against a seeded legacy directory, opening API Configuration, and sending a message that
  demonstrably reaches the migrated provider.
- One screenshot per shape of API Configuration after migration.
- Paste the `providers.json` for each shape into your report.

## Report

Per shape: pass or fail against the four criteria, plus anything that surprised you. For each failure give the
seeded `globalState.json`, the resulting `providers.json`, the click path, and the file you suspect.
