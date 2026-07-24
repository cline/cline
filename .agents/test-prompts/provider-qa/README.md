# Provider QA prompt pack

Five prompts covering LLM provider configuration in Cline, written to be executed by **autonomous computer-use
agents** rather than read by a person. Hand one file to one agent. Each is self-contained: a pasteable credentials
JSON, a preflight, numbered test cases with explicit pass/fail conditions, and a JSON report schema so five agents'
results merge into one picture.

They are split so that the five can run in parallel on separate machines. On a single machine they must run
sequentially, because each drives a real VS Code window and `qa-env.sh` refuses to start a second instance.

| Prompt | Question it answers | Needs real keys? |
|--------|--------------------|------------------|
| [A — Setup and migration](./A-setup-and-migration.md) | Can a user get configured, from a clean install and from an upgrade? | Yes |
| [B — Persistence and model selection](./B-persistence-and-model-selection.md) | Does what you picked stay picked, and can you pick it at all? | Mostly no |
| [C — Config options on the wire](./C-config-options-on-the-wire.md) | Is every provider setting actually functional? | Mostly no |
| [D — Tool calling](./D-tool-calling.md) | Can each provider edit a file and run a command, once, with intact arguments? | Yes |
| [E — Cost and errors](./E-cost-and-errors.md) | Are the numbers sane and the failures readable? | Half |

## Written for agents, which changes the design

These prompts were shaped by watching computer-use agents fail at this exact task. Four failure modes recurred, and
each one produced a rule that every prompt now enforces:

- **Agents relaunch things.** One decided VS Code looked wrong and started its own with different flags, silently
  invalidating the run. Every prompt forbids typing `code` and routes all lifecycle through `qa-env.sh`, which
  refuses to start a second instance rather than letting two windows quietly attach to each other.
- **Agents misread the screen.** One reported a model id as `1autlok`; another reported a token count that was
  actually a context-window figure. So no prompt asks an agent to establish a fact by reading it: the screen drives
  the UI and captures evidence, and `qa-env.sh state` and the proxy log establish what is true.
- **Agents fill in plausible detail.** Every case has explicit `PASS IF` / `FAIL IF` text instead of asking for
  judgement, every finding requires a reproduction, and the report schema has a `blocked`/`skipped` status so
  "did not happen" is representable.
- **Agents try to fix things.** All five forbid editing source or working around a bug, because a bug that gets
  worked around is a bug nobody hears about.

## The credentials block

All five prompts embed the **same** JSON, so it gets filled in once and pasted into every agent. Empty strings are
skipped, and each prompt requires its agent to report what it could not cover.

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
settings UI labels them "OpenAI Compatible" and "OpenAI". Prompts B, C, D and E ship with the `openai-compatible`
entry pre-pointed at the local mock, because it doubles as their wire observer.

## Fixtures

### `qa-env.sh` — the only way an agent touches VS Code

```bash
qa-env.sh start <slug> [--keys <file> --select <provider>]
qa-env.sh status | state <slug> | stop <slug> | recover <slug>
qa-env.sh proxy start|stop|reset|count|tail|models
qa-env.sh doctor
```

`start` creates an isolated data directory and VS Code profile, optionally applies a keys file, launches, and
**waits until the extension has actually activated** before printing `READY`. It refuses to run while another
instance is up. `doctor` checks the display, the build artifacts, and — critically — launches a plain VS Code with
no extension as a control, so an agent can tell an environment failure apart from a Cline bug instead of filing the
former as the latter.

The launch flags are load-bearing:

- `--disable-dev-shm-usage` — this VM gives `/dev/shm` only 64 MB, and without this the renderer dies at startup
  with `renderer process gone (reason: crashed, code: 133)`. This cost an hour to find; it looks exactly like a
  broken extension.
- `--disable-workspace-trust` — otherwise VS Code opens in Restricted Mode and blocks command execution, which
  looks exactly like a broken `run_commands` tool.
- `--no-sandbox` — required in this container.

`stop` sends SIGTERM only, because SIGKILL corrupts the VS Code profile and poisons every later launch with the
same crash-133 dialog. `recover` is the one place escalation is allowed, and only because it deletes the profile
immediately afterwards — a window stuck on the crash modal ignores SIGTERM.

### `apply-keys.mjs`

Turns the keys JSON into a ready-to-use `providers.json`, so runs that only need to *be* configured skip the form.

```bash
node fixtures/apply-keys.mjs --keys /tmp/qa-keys.json --list
node fixtures/apply-keys.mjs --keys /tmp/qa-keys.json --dir /tmp/cline-qa/data --select anthropic
node fixtures/apply-keys.mjs --keys /tmp/qa-keys.json --print-env
```

Verified end to end in both hosts: the CLI resolves provider, base URL, key and model from it with no interactive
setup, and the VS Code extension opens straight into chat with the pre-written provider selected rather than
demanding onboarding. Every prompt uses the CLI form as a per-credential smoke test, because diagnosing a bad key
through a GUI is slow and agents are bad at it.

Prompt A's clean-install cases deliberately do **not** use it — clicking through the form is what they test.

### `fault-proxy.mjs`

An OpenAI-compatible endpoint whose behaviour is chosen by the model id, so an agent reproduces a rate limit or a
mangled tool call by selecting `fault/429` or `fault/tool-mangled-args` instead of waiting for a real provider to
misbehave. It logs every request, which is how prompts B, C and D establish ground truth, and serves ~19 models
from `/v1/models` so it exercises live model-list fetching too. Reach it through `qa-env.sh proxy`.

### `seed-legacy-config.mjs` and `run-migration.ts`

Seed a pre-migration `globalState.json` + `secrets.json` pair (seven shapes) with `providers.json` deliberately
absent, so the real migration has to run; and trigger that migration headlessly to see what it produced.

## What the pack has already found

Four findings came out of building and dry-running it. Each is written into the relevant prompt as a case the agent
**confirms and extends**, rather than something it might stumble on.

- **The wire can disagree with both the UI and disk.** An isolated run configured with model `fault/ok` sent its
  request as `fault/context-overflow`; the value came from `~/.cline/data/globalState.json`, outside the run's
  `CLINE_DATA_DIR` entirely. Confirmed causally by editing that home file and watching the wire follow it. Two
  problems behind one symptom: `CLINE_DATA_DIR` is not honoured for the legacy globalState store, and the effective
  model comes from `actModeApiModelId` rather than from `providers.json`. Prompt B, case B0 — the highest-severity
  item in the pack, and exactly the silent-reset class the original brief described.
- **Migration drops a per-mode model id.** With plan and act on different providers,
  `migrateLegacyProviderSettings` reads one `mode` from `globalState.mode` and applies it to every candidate
  provider, so the other mode's model id is never read. Prompt A, case A2-known.
- **The Model ID autocomplete commits a longer prefix match.** Typing `fault/ok` commits `fault/ok-no-cache`.
  Prompt B, case B2-prefix.
- **Error rows offer no retry and no differentiation.** 401, 429 and context-overflow all rendered as the same
  plain red text with no Retry affordance, including cases with dedicated components. Prompt E, cases
  E3-retry-affordance and E3-classification.

## Conventions every prompt follows

- **Isolated state.** Each run gets its own `CLINE_DATA_DIR` and VS Code profile. Half the bug class being hunted
  is stale state leaking into a fresh session — and per B0, the isolation is not currently airtight.
- **Verify on the wire, not in the widget.** A dropdown showing the right model proves nothing.
- **Smoke-test credentials headlessly first.** A key that fails `bun run cli` is a bad credential, not a bug.
- **One video per prompt minimum**, starting immediately before the interesting interaction.
- **Findings need a reproduction**: exact steps, expected, actual, evidence, suspected file.
