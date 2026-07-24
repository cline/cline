# Provider QA A — Can a user get configured at all?

Two ways a user arrives at a working provider: a clean install where they set one up from scratch, and an upgrade
where their old config has to survive. This run covers both. Nothing here assumes any other QA run has happened.

Report at the end using the template at the bottom. Record video. Click things like a user would rather than
editing config files, except where a step explicitly says to inspect state on disk.

## Your credentials

Save this as `/tmp/qa-keys.json` and fill in whatever you have. Leave the rest as empty strings — empty entries are
skipped automatically, and you will report which providers you could not cover. Provider ids are SDK ids;
`openai-compatible` is any OpenAI-shaped endpoint, `openai-native` is api.openai.com.

```json
{
  "anthropic":         { "apiKey": "", "model": "claude-sonnet-4-5-20250929" },
  "openai-native":     { "apiKey": "", "model": "gpt-5.1" },
  "openrouter":        { "apiKey": "", "model": "anthropic/claude-sonnet-4.5" },
  "gemini":            { "apiKey": "", "model": "gemini-2.5-pro" },
  "cline":             { "apiKey": "", "model": "anthropic/claude-sonnet-4.5" },
  "deepseek":          { "apiKey": "", "model": "deepseek-chat" },
  "groq":              { "apiKey": "", "model": "llama-3.3-70b-versatile" },
  "xai":               { "apiKey": "", "model": "grok-4" },
  "mistral":           { "apiKey": "", "model": "mistral-large-latest" },
  "requesty":          { "apiKey": "", "model": "" },
  "together":          { "apiKey": "", "model": "" },
  "vercel-ai-gateway": { "apiKey": "", "model": "" },
  "openai-compatible": { "apiKey": "", "baseUrl": "", "model": "" },
  "litellm":           { "apiKey": "", "baseUrl": "", "model": "" },
  "ollama":            { "baseUrl": "http://127.0.0.1:11434", "model": "" },
  "bedrock":           { "awsAccessKey": "", "awsSecretKey": "", "awsRegion": "us-west-2", "model": "anthropic.claude-sonnet-4-20250514-v1:0" },
  "vertex":            { "vertexProjectId": "", "vertexRegion": "us-east5", "model": "claude-sonnet-4@20250514" }
}
```

Check what the file gives you, and confirm each key works before spending any time in the UI:

```bash
cd /workspace
node .agents/test-prompts/provider-qa/fixtures/apply-keys.mjs --keys /tmp/qa-keys.json --list

# Headless smoke test per provider — much faster than diagnosing a bad key through the GUI
export SMOKE=/tmp/cline-qa/smoke
rm -rf "$SMOKE" && node .agents/test-prompts/provider-qa/fixtures/apply-keys.mjs \
  --keys /tmp/qa-keys.json --dir "$SMOKE/data" --select anthropic
CLINE_DATA_DIR="$SMOKE/data" bun run cli "Reply with exactly PONG."
```

Repeat the last two lines with `--select <provider>` for each credential you were given. Any key that fails here is
a bad credential, not a product bug — say so in your report and move on.

## Environment

```bash
cd /workspace/apps/vscode && bun run build:webview && bun esbuild.mjs   # only if dist/extension.js is stale
```

Launch VS Code like this, substituting the data directory each section calls for:

```bash
tmux -f /exec-daemon/tmux.portal.conf new-session -d -s vscode-qa -- \
  env DISPLAY=:1 CLINE_DATA_DIR="$QA/data" \
  code --no-sandbox --disable-workspace-trust --user-data-dir="$QA/vscode-userdata" \
       --extensionDevelopmentPath=/workspace/apps/vscode "$QA/workspace"
```

Operational rules, learned the hard way:

- **One VS Code instance at a time.** A second `code` with the same `--user-data-dir` attaches to the first
  instead of starting fresh, and you will silently test the wrong window. Check with
  `ps -eo pid,args | grep [e]xtensionDevelopmentPath` before and after every launch.
- **Never `kill -9` VS Code.** It poisons the profile and every subsequent launch dies with *"The window
  terminated unexpectedly (reason: 'crashed', code: '133')"*. Use `kill -TERM` and wait.
- **If you do see crash 133**, kill the process, `rm -rf "$QA/vscode-userdata"`, and relaunch. If a plain
  `code --no-sandbox --user-data-dir=/tmp/vanilla` with no `--extensionDevelopmentPath` *also* crashes, the display
  is degraded — that is an environment failure, not a Cline bug, and you should report it as such rather than
  filing it against the product.
- `--disable-workspace-trust` matters. Without it VS Code opens in Restricted Mode and blocks command execution,
  which looks exactly like a broken tool.

Reaching the settings: Cline icon in the Activity Bar → on an empty data directory you get onboarding
(**Bring my own API key** → **Continue**), otherwise the chat view. The same form lives behind the gear icon in the
Cline navbar; **Done** closes it.

## Part 1 — Clean install, one provider at a time

Do **not** use `apply-keys.mjs` here. Clicking through the form is the thing being tested.

For each provider you have a credential for, start genuinely cold:

```bash
export P=anthropic
export QA="/tmp/cline-qa/cold-$P"
rm -rf "$QA" && mkdir -p "$QA/workspace"
printf 'export const name = "john"\n' > "$QA/workspace/qa.txt"
```

Then launch, and:

1. Confirm you land on onboarding, not chat. Landing in chat with no provider configured is a bug by itself.
2. Choose **Bring my own API key** → **Continue**.
3. Find the provider in the **API Provider** field by typing a partial name a real user would type. Confirm it is
   findable that way, not just by its exact id.
4. Paste the credential; confirm it masks.
5. Pick a model. If the provider fetches its list live, confirm the list populates first. The Model ID field is an
   autocomplete and will commit a longer prefix match — typing one id can leave you on a different one — so read
   back the committed value before continuing.
6. Send `Reply with exactly PONG and nothing else.` and confirm a real streamed reply.
7. Send `What word did you just say?` — this catches providers whose first turn works but whose history is not
   threaded.
8. Confirm the model shown in the chat footer matches what you selected, and that the task header shows a token
   count.

Cover in this order, stopping when you run out of credentials: `anthropic`, `openai-native`, `openrouter`,
`gemini`, `cline` (OAuth rather than a key), `openai-compatible`, then any of `deepseek`, `groq`, `xai`, `mistral`,
`requesty`, `together`, `vercel-ai-gateway`. If `bedrock` or `vertex` credentials are present, test them too — they
use a different auth shape and break differently. `ollama` needs no key; test it if a local server is running.

For OAuth providers also confirm the browser flow opens on `DISPLAY=:1`, completes, and that cancelling it leaves
the UI usable rather than stuck.

Failures to watch for: a valid credential producing an auth error; the preselected default model not being a model
that provider actually serves (`providerSwitchNormalization.ts` snaps the model id on provider switch, and a bad
snap shows up here as an immediate 404); a reply that never arrives and never errors; the second turn losing
context.

## Part 2 — Upgrade, with old config on disk

Cline used to keep provider credentials in `globalState.json` + `secrets.json`; they now live in
`settings/providers.json`. Migration runs automatically on activation. The failure that matters is silent: the
extension starts, nothing errors, and a key or model or per-mode selection is quietly gone.

Seed an old-format directory and launch against it:

```bash
export QA=/tmp/cline-qa/migration
rm -rf "$QA" && mkdir -p "$QA/workspace"
node /workspace/.agents/test-prompts/provider-qa/fixtures/seed-legacy-config.mjs \
  --shape anthropic --dir "$QA/data" --force
```

`--list` shows all seven shapes; run every one. `--key <real key>` substitutes a live credential so the migrated
config can also send a request. For a fast check of what migration produced before opening the UI:

```bash
bun /workspace/.agents/test-prompts/provider-qa/fixtures/run-migration.ts "$QA/data"
```

Each shape passes only if all four hold:

1. The UI opens on the provider from the legacy config, with the legacy model selected and the key present and
   masked. Not the default provider, not an empty model, and not onboarding.
2. `cat "$QA/data/settings/providers.json"` matches: the entry exists, carries `"tokenSource": "migration"`, and
   the key, model and base URL are what was seeded.
3. A message actually reaches the provider the legacy config named. With a placeholder key, an auth error naming
   the right provider is a pass; an error naming a *different* provider is a failure.
4. With the `many-keys` shape, all nine credentials migrate but the selection stays on `gemini`.

Then the re-entrancy cases, which are where upgrades usually go wrong:

- **Idempotent.** Relaunch against the same directory; `providers.json` must not gain duplicates or change values.
- **Never clobbers newer data.** Launch, change the model in the UI, close, relaunch. Your edit must win. An
  upgrade that resurrects an old model id on every restart is the worst outcome here.
- **Partial state.** Delete the model id key from `globalState.json`, `rm` `providers.json`, relaunch. Expect the
  provider selected with a sane default, not a blank dropdown.
- **Corrupt state.** Write `{` into `globalState.json` and relaunch. Expect an unconfigured provider and a readable
  message, not a broken webview.

### A known finding to confirm and write up

This already reproduces headlessly:

```bash
node /workspace/.agents/test-prompts/provider-qa/fixtures/seed-legacy-config.mjs \
  --shape split-plan-act --dir /tmp/cline-qa/split/data --force
bun /workspace/.agents/test-prompts/provider-qa/fixtures/run-migration.ts /tmp/cline-qa/split/data
```

The seeded config is plan = anthropic / `claude-opus-4-1-20250805`, act = openrouter / `z-ai/glm-4.6`, with
`mode: "plan"`. Both providers migrate and both keys survive, but the OpenRouter entry comes out holding the
catalog default instead of `z-ai/glm-4.6`. `migrateLegacyProviderSettings` reads a single `mode` from
`globalState.mode` and passes it to every candidate provider, so `resolveModelForProvider` looks up
`planModeOpenRouterModelId`, finds nothing, and falls through to `getDefaultModelForProvider`. The act-mode id is
on disk and simply never read.

Establish in the UI which model an Act-mode request actually uses after this migration, and whether the user is
told their model changed.

## Artifacts

- One video per tier-1 provider (`anthropic`, `openai-native`, `openrouter`, `gemini`, `cline`): empty state
  through to a streamed reply. Start recording at the provider dropdown and stop when the reply lands.
- One video of launching against a seeded legacy directory and sending a message that demonstrably reaches the
  migrated provider.
- One screenshot per remaining provider showing the configured form and the reply together.
- Paste each shape's resulting `providers.json` into the report.

## Report

Two tables.

**Clean install:** provider, credential type, setup succeeded, first message, second message, model actually used,
notes. List explicitly which providers you could not test and why.

**Migration:** shape, all four criteria, plus the re-entrancy results.

For every failure: the exact click path, the error text, the on-disk state before and after, and the file you
suspect.
