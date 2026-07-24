# Provider QA prompt pack

Five independent manual-QA runs covering LLM provider configuration in Cline. Each lettered file is a **complete,
standalone prompt**: hand the whole file to one cloud runner and it has everything it needs — a credentials block
to paste keys into, setup commands, the verified click path, pass/fail criteria, and the artifacts to produce.
Nothing in a prompt depends on another prompt having been run first, and each uses its own isolated data
directory, so all five can run in parallel.

| Prompt | Question it answers | Needs real keys? |
|--------|--------------------|------------------|
| [A — Setup and migration](./A-setup-and-migration.md) | Can a user get configured, from a clean install and from an upgrade? | Yes |
| [B — Persistence and model selection](./B-persistence-and-model-selection.md) | Does what you picked stay picked, and can you pick it at all? | Mostly no |
| [C — Config options on the wire](./C-config-options-on-the-wire.md) | Is every provider setting actually functional? | Mostly no |
| [D — Tool calling](./D-tool-calling.md) | Can each provider edit a file and run a command, once, with intact arguments? | Yes |
| [E — Cost and errors](./E-cost-and-errors.md) | Are the numbers sane and the failures readable? | Half |

## The credentials block

All five prompts embed the **same** JSON, so you fill it in once and paste the identical file into every runner.
Anything left as an empty string is skipped, and each prompt tells its runner to report which providers it could
not cover.

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

Provider ids are SDK ids. `openai-compatible` is any OpenAI-shaped endpoint; `openai-native` is api.openai.com. The
settings UI labels them "OpenAI Compatible" and "OpenAI".

## Fixtures

Four helpers in [`fixtures/`](./fixtures), shared across the prompts.

### `apply-keys.mjs`

Turns a filled-in keys file into a ready-to-use Cline data directory, so a run can start from a configured provider
instead of clicking through a form. Writes `settings/providers.json`, which holds both the credentials and the
active-provider pointer.

```bash
node fixtures/apply-keys.mjs --keys /tmp/qa-keys.json --list
node fixtures/apply-keys.mjs --keys /tmp/qa-keys.json --dir /tmp/cline-qa/data --select anthropic
node fixtures/apply-keys.mjs --keys /tmp/qa-keys.json --print-env
```

This is verified end to end: applying a keys file and then running
`CLINE_DATA_DIR=<dir> bun run cli "Reply with exactly PONG."` produces a real request on the configured endpoint
with the configured model and key, with no interactive setup at all. Every prompt uses that as a per-credential
smoke test, because diagnosing a bad key through the GUI is slow.

Prompt A's clean-install section deliberately does **not** use this — clicking through the form is what it tests.

### `fault-proxy.mjs`

An OpenAI-compatible endpoint whose behaviour is chosen by the model id, so a tester reproduces a rate limit or a
mangled tool call by picking `fault/429` or `fault/tool-mangled-args` in the model dropdown instead of waiting for
a real provider to misbehave. It also logs every inbound request, which is how prompt C proves a setting reached
the wire, and serves ~19 models from `/v1/models` so it exercises live model-list fetching too.

```bash
node fixtures/fault-proxy.mjs          # http://127.0.0.1:8788/v1
tail -1 /tmp/fault-proxy.jsonl | python3 -m json.tool
curl -s localhost:8788/__requests      # request count, for retry-storm checks
```

Configure it in the UI as **OpenAI Compatible**, base URL `http://127.0.0.1:8788/v1`, any non-empty API key.

### `seed-legacy-config.mjs`

Writes a pre-migration `globalState.json` + `secrets.json` pair (seven shapes) and deliberately omits
`providers.json`, so the real migration in `provider-settings-legacy-migration.ts` has to run.

```bash
node fixtures/seed-legacy-config.mjs --list
node fixtures/seed-legacy-config.mjs --shape split-plan-act --dir /tmp/cline-qa/data --force
```

### `run-migration.ts`

Triggers that migration headlessly and prints the resulting `providers.json`, for a fast check before spending time
in the UI. Needs `bun run build:sdk`.

```bash
bun fixtures/run-migration.ts /tmp/cline-qa/data
```

## Running VS Code in this environment

Every prompt launches its own instance. The click path, confirmed by running the error-path section end to end:
Cline icon in the Activity Bar → onboarding on an empty data directory (**Bring my own API key** → **Continue**) →
the provider form. Afterwards the same form is behind the gear icon in the Cline navbar, and **Done** closes it.

Three operational rules that cost real time to learn, repeated in every prompt:

- **One instance at a time.** A second `code` sharing a `--user-data-dir` attaches to the first rather than
  starting fresh, so you can silently test a window you did not configure.
- **Never `kill -9`.** It poisons the VS Code profile, and every later launch dies with *"The window terminated
  unexpectedly (reason: 'crashed', code: '133')"*. Recover by killing the process, `rm -rf`-ing the
  `--user-data-dir` (which leaves the Cline data directory untouched), and relaunching.
- **Distinguish environment failures from product bugs.** If a plain `code` with no `--extensionDevelopmentPath`
  also crashes, the display is degraded and nothing you see is about Cline.

Also launch with `--disable-workspace-trust`; without it VS Code opens in Restricted Mode and blocks command
execution, which looks exactly like a broken tool.

## What the pack has already found

Three findings came out of building and dry-running these prompts, each written up in place with a reproduction:

- **Migration drops a per-mode model id.** With plan and act on different providers,
  `migrateLegacyProviderSettings` reads a single `mode` from `globalState.mode` and applies it to every candidate
  provider, so the other mode's model id is never read and that provider silently lands on a catalog default.
  Prompt A.
- **The Model ID autocomplete commits a longer prefix match.** Typing `fault/ok` commits `fault/ok-no-cache`.
  Prompt B.
- **Error rows offer no retry and no differentiation.** 401, 429 and context-overflow all rendered as the same
  plain red text with no Retry affordance, including the cases that have dedicated components. Prompt E.

## Conventions every prompt follows

- **Isolated state.** Each run gets its own `CLINE_DATA_DIR` and its own VS Code `--user-data-dir`. Half the bug
  class being hunted is stale state leaking into a fresh session, so this is not optional.
- **Verify on the wire, not in the widget.** A dropdown showing the right model proves nothing. Every persistence
  and configuration check ends with a real request whose destination and payload were observed.
- **Smoke-test credentials headlessly first.** A key that fails `bun run cli` is a bad credential, not a product
  bug, and finding that out through the GUI is slow.
- **One video per prompt, minimum**, starting immediately before the interesting interaction rather than during
  setup.
- **Findings are filed with a repro**: exact clicks, on-disk state before and after, and the suspected file.
