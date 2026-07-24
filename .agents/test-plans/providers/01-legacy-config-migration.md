# QA prompt 1 — Legacy provider config migration

You are doing **manual QA on the Cline VS Code extension**. Your job: prove that a user upgrading
from the old provider-config storage lands with a working, correct configuration — not a broken or
half-migrated one.

## Ground rules (do not negotiate these)

1. Every UI action goes through the `computerUse` subagent, driving a real VS Code window on
   `DISPLAY=:1`. Real clicks only.
2. Banned as substitutes for clicking: Playwright / `bun run e2e`, the mock API server at
   `localhost:7777` (`apps/vscode/src/test/e2e/fixtures/server`), `page.evaluate`, direct gRPC
   calls, and "setting up" a provider by editing config files. Reading config files afterwards to
   *verify* is required; writing them to *skip a UI step* is forbidden — **except** for the
   deliberate legacy seeding this plan is built around, which is called out explicitly per case.
3. Real network, real keys, real models.
4. A case is PASS only if you saw the expected result on screen **and** have one out-of-band
   corroboration (file contents, session record, log line). Statuses: PASS / FAIL / BLOCKED /
   SKIPPED. Never write "should work" or infer a result from reading source.
5. Do not edit product code to make a test pass. Record bugs and keep going.
6. Screenshot every case. Record video for the end-to-end cases (M9, M10).

## Environment setup

```bash
# 1. Build the extension (webview + bundle)
cd /workspace/apps/vscode
bun run build:webview && bun esbuild.mjs

# 2. Isolated lane (this prompt owns lane p1; never touch ~/.cline)
export LANE=/tmp/cline-qa/p1
mkdir -p $LANE/clinedir/data/settings $LANE/userdata $LANE/workspace
printf 'export function add(a: number, b: number) {\n\treturn a + b\n}\n' > $LANE/workspace/math.ts
printf '# QA workspace\n' > $LANE/workspace/README.md
```

Launch the dev host in a tmux session so it survives (repeat this whenever a case says "relaunch"):

```bash
tmux -f /exec-daemon/tmux.portal.conf new-session -d -s vscode-p1 -c /workspace -- bash -l
tmux -f /exec-daemon/tmux.portal.conf send-keys -t vscode-p1:0.0 \
  'env -u OPENROUTER_API_KEY -u CLINE_API_KEY -u ANTHROPIC_API_KEY -u OPENAI_API_KEY \
   DISPLAY=:1 CLINE_DIR=/tmp/cline-qa/p1/clinedir \
   code --no-sandbox --disable-gpu --disable-workspace-trust \
   --user-data-dir=/tmp/cline-qa/p1/userdata --extensions-dir=/tmp/cline-qa/p1/userdata/exts \
   --extensionDevelopmentPath=/workspace/apps/vscode /tmp/cline-qa/p1/workspace 2>&1 | tee -a /tmp/cline-qa/p1/vscode.log' C-m
```

The `env -u` matters: provider keys in the ambient environment are used as a **fallback** when no
key is stored (`sdk/packages/llms/src/providers/http.ts`), so leaving them set can make a failed
migration look like a success. Strip every provider env var whose key you are seeding by hand.

Kill the window between cases with the PID from `pgrep -f extensionDevelopmentPath` — never
`pkill -f`.

First launch of a fresh profile shows VS Code first-run dialogs (Copilot sign-in, theme picker) —
dismiss them, then click the Cline robot icon in the Activity Bar.

## What "old config" means here

Three storage generations exist. You are testing the boundary between generation 2 and 3.

| Gen | Where | Shape |
|-----|-------|-------|
| 1 | VS Code memento (`state.vscdb`) | flat `apiProvider`, `apiModelId` |
| 2 | `<CLINE_DIR>/data/globalState.json` + `secrets.json` | mode-prefixed `planModeApiProvider`, `actModeOpenRouterModelId`, plus flat `anthropicBaseUrl`, `openAiHeaders`, `awsRegion`, and secrets like `apiKey`, `openAiApiKey` |
| 3 | `<CLINE_DIR>/data/settings/providers.json` | nested `providers.<id>.settings` with `apiKey`, `model`, `baseUrl`, `reasoning`, `aws`, `azure`, … |

Migration code: `sdk/packages/core/src/services/storage/provider-settings-legacy-migration.ts`.
It runs whenever a `ProviderSettingsManager` is constructed, has **no version sentinel**, and
**never overwrites** an existing entry in `providers.json` — it only adds missing provider ids and
tags them `tokenSource: "migration"`. Field names for seeding are the `LegacyGlobalState` and
`LegacySecrets` interfaces at the top of that file; the legacy→new secret map is
`secretByProvider` around line 456. Use those as the source of truth for your seed files, not your
memory.

To re-run a migration: delete `<CLINE_DIR>/data/settings/providers.json` (or just the one provider
entry), leave `globalState.json` / `secrets.json` in place, and relaunch.

## Test cases

For every case: seed files → launch → open Cline → **look at the UI first**, then check disk.
The UI check is the point; the file check is corroboration.

### M1 — Anthropic, classic key + base URL + thinking budget

Seed before first launch (`$LANE/clinedir/data/globalState.json`):

```json
{
  "mode": "act",
  "actModeApiProvider": "anthropic",
  "planModeApiProvider": "anthropic",
  "actModeApiModelId": "claude-sonnet-4-6",
  "planModeApiModelId": "claude-sonnet-4-6",
  "actModeThinkingBudgetTokens": 2048,
  "requestTimeoutMs": 90000
}
```

`secrets.json`: `{ "apiKey": "<real Anthropic key>" }`

Expected: Settings → API Configuration shows **Anthropic** selected with the migrated model, the
key field populated (masked), and no error banner. `providers.json` contains an `anthropic` entry
with `tokenSource: "migration"` and `reasoning.budgetTokens: 2048`.

### M2 — Legacy `openai` renames to `openai-compatible`

Seed `actModeApiProvider: "openai"`, `openAiBaseUrl`, `actModeOpenAiModelId`, and
`openAiHeaders: {"X-QA-Header": "1"}`; secrets `{ "openAiApiKey": "..." }`.

Expected: the provider id in `providers.json` is **`openai-compatible`** (not `openai`), headers
and base URL are nested under its `settings`, a matching entry appears in
`<CLINE_DIR>/data/settings/models.json`, and the UI shows the OpenAI-Compatible form pre-filled
with that base URL and model id. Confirm the custom header actually goes out on the wire by
sending a message and checking the provider/gateway side if you can, otherwise mark that half
BLOCKED with a reason.

### M3 — Separate Plan and Act providers survive

Seed `planModeApiProvider: "anthropic"` + `actModeApiProvider: "openrouter"` with
`actModeOpenRouterModelId` set and both keys in `secrets.json`.

Expected: both providers exist in `providers.json`; with **Use different models for Plan and Act
modes** enabled in the UI, the Plan sub-tab shows Anthropic and the Act sub-tab shows OpenRouter
with the seeded model. Switching Plan↔Act in the chat header swaps the model chip accordingly.

### M4 — Migration is non-destructive

Pre-create a `providers.json` containing one hand-made entry (`tokenSource: "manual"`, a distinct
model id), then seed legacy state for a *different* provider and relaunch.

Expected: the manual entry is byte-for-byte unchanged (compare before/after), and the legacy
provider is added alongside it.

### M5 — Idempotent across restarts

Relaunch three times against the same seeded state.

Expected: no duplicate providers, no key churn, `updatedAt` on already-migrated entries does not
advance, and `providers.json` stays valid JSON. Diff the file after each launch.

### M6 — Cline account blob

Seed `secrets.json` with a `cline:clineAccountId` JSON blob (shape: `LegacyClineUserInfo` in the
migration file — `idToken`, `refreshToken`, `expiresAt`, `userInfo.id`).

Expected: `providers.cline.settings.auth` is populated with `accessToken` / `refreshToken` /
`accountId`, `expiresAt` is converted to **milliseconds**, and the UI shows the Cline account as
signed in rather than prompting for sign-in. If you cannot obtain a real blob, seed a
syntactically valid fake and assert only on the shape conversion, then mark the "actually usable"
half SKIPPED.

### M7 — Bedrock auth-mode rename

Seed `awsAuthentication: "credentials"` plus `awsRegion`, `awsAccessKey`, `awsSecretKey`.

Expected: `providers.bedrock.settings.aws.authentication` is **`iam`** (the rename), region and
credentials carried over, and the Bedrock form in the UI shows the matching auth mode selected.

### M8 — Garbage in, no crash out

Seed a corrupt `globalState.json` (truncated JSON), then a valid one with an unknown provider id
(`"actModeApiProvider": "totally-made-up"`), then one with an empty-string key.

Expected in all three: the extension still activates, the Cline webview still renders, the
settings page is usable, and any complaint is a readable message — not a stack trace in the
webview and not a hang. Capture the Cline output channel for each.

### M9 — Migrated config actually works (end-to-end, record video)

Using the M1 or M3 seed, without re-entering the key: send a real chat message and get a real
reply.

Expected: the reply streams in, the cost badge in the task header is non-zero, and the session
record names the expected provider and model:

```bash
for f in $LANE/clinedir/data/sessions/*/*.json; do
  case "$f" in *.messages.json) continue;; esac
  jq -c '{provider, model, usage: .metadata.usage}' "$f"
done
```

This is the case that proves migration moved a *usable* credential, not just JSON.

### M10 — Migrated config survives the settings round-trip (record video)

After M9, open Settings → API Configuration, change nothing, click Done, then reload the window
(Command Palette → **Developer: Reload Window**).

Expected: the provider and model are unchanged, `tokenSource` is still `migration` (or flips to
`manual` only if you actually edited something), and the next message still works. A silent flip
to Anthropic or to a default model here is a **FAIL** and the highest-value bug in this plan.

### M11 — Clean install should not "migrate" anything

Start from a completely empty `CLINE_DIR` with **no** seeded legacy files, launch, and configure
one provider through the UI.

Expected: `providers.json` contains only the provider you configured, with
`tokenSource: "manual"`. Observed while authoring this plan: a fresh profile ended up with an extra
`sapaicore` entry tagged `tokenSource: "migration"`, apparently because default values the
extension writes into `globalState.json` (`sapAiCoreUseOrchestrationMode`, `ocaMode`) look like
legacy config to the migrator. Confirm whether that reproduces, list every provider entry that
appears without the user asking for it, and check whether any of them can end up selected.

## Report format

A table of `ID | status | what you saw | evidence`, then one section per bug with: exact repro
steps, seed JSON used, screenshots, the relevant `providers.json` before/after, and the Cline
output-channel excerpt. Attach the screen recordings for M9/M10. List every case you marked
SKIPPED with the missing credential's env var name.
