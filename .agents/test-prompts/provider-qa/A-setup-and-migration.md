# Provider QA A — Setup and migration

You are a QA agent. You drive a real VS Code window on `DISPLAY=:1` and report what you observe. You are testing
whether a user can get a working provider: from a clean install, and from an upgrade with old config on disk.

## Hard rules

Violating any of these invalidates the run.

1. **Launch and stop VS Code only through `qa-env.sh`** (below). Never type a `code` command yourself. Two
   instances sharing a profile silently attach to each other and you will test a window you did not configure.
2. **Never `kill -9` VS Code.** Use `qa-env.sh stop`. If it will not die, use `qa-env.sh recover`.
3. **Never edit source code, and never "fix" anything.** You are observing, not repairing. A bug you work around
   is a bug nobody hears about.
4. **Never read a value that matters off the screen.** Screen text is small and easy to misread. Anything that
   decides pass or fail — model ids, provider ids, keys, token counts — must be confirmed with a terminal command.
   Use the screen to drive the UI and to capture evidence, use the terminal to establish facts.
5. **Report only what you observed.** If a step did not happen, mark it `blocked` or `skipped` and say why. Never
   infer a plausible result.
6. **Do not report a bug without a reproduction.** Exact steps, expected, actual, and evidence.

## Stop conditions

Stop and report immediately if: `qa-env.sh start` fails twice in a row after a `recover`; `qa-env.sh doctor` says
the environment is at fault; or the workspace under test has been modified in a way you cannot explain.

## Credentials

Save exactly this as `/tmp/qa-keys.json`, with your keys filled in. Leave anything you were not given as an empty
string — empty entries are skipped and you will report them as untested. Provider ids are SDK ids;
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

## Preflight — do this before any UI work

```bash
export QA=/workspace/.agents/test-prompts/provider-qa/fixtures
cd /workspace

bash $QA/qa-env.sh doctor          # must not report ENVIRONMENT FAILURE
node $QA/apply-keys.mjs --keys /tmp/qa-keys.json --list
```

Then smoke-test every credential headlessly. A key that fails here is a bad credential, not a product bug, and
finding that out by clicking is slow.

```bash
for P in anthropic openrouter gemini openai-native; do   # extend to every provider you were given a key for
  rm -rf /tmp/cline-qa/smoke
  node $QA/apply-keys.mjs --keys /tmp/qa-keys.json --dir /tmp/cline-qa/smoke/data --select "$P" >/dev/null 2>&1 \
    && echo "--- $P ---" \
    && CLINE_DATA_DIR=/tmp/cline-qa/smoke/data timeout 120 bun run cli "Reply with exactly PONG." 2>&1 | tail -2
done
```

Record the usable and unusable lists in your report. Only test providers whose key is usable.

## How to run VS Code

```bash
bash $QA/qa-env.sh start <slug>      # fresh data dir, fresh profile, launches and waits for activation
bash $QA/qa-env.sh status            # confirm exactly ONE instance
bash $QA/qa-env.sh state <slug>      # dump providers.json and the legacy globalState
bash $QA/qa-env.sh stop <slug>
bash $QA/qa-env.sh recover <slug>    # only after a failed start
```

`start` prints `READY` when the extension has activated. It refuses to run while another instance is up — that
refusal is protecting your run, do not work around it.

Reaching the UI: click the Cline icon in the VS Code Activity Bar. On an empty data directory Cline shows
onboarding: **Bring my own API key** → **Continue** → the provider form. Afterwards the same form is behind the
gear icon in the Cline navbar, and **Done** closes it. Dismiss any VS Code welcome/Copilot/theme modal first.

Known UI trap: the **Model ID** field is an autocomplete and commits a longer prefix match — typing one id can
leave you on a different one. After setting it, confirm the committed value with `qa-env.sh state <slug>`, not by
looking at the field.

---

## Case group A1 — Clean install, per provider

Do **not** use `apply-keys.mjs` here. Clicking through the form is what is under test.

Run A1 once per provider with a usable key, in this order, stopping when you run out: `anthropic`,
`openai-native`, `openrouter`, `gemini`, `cline`, `openai-compatible`, then any of `deepseek`, `groq`, `xai`,
`mistral`, `requesty`, `together`, `vercel-ai-gateway`, then `bedrock` and `vertex` if present. `ollama` needs no
key; include it if a local server responds to `curl -s localhost:11434/api/tags`.

Case id is `A1-<provider>`.

**Steps**

1. `bash $QA/qa-env.sh stop <previous-slug>` then `bash $QA/qa-env.sh start cold-<provider>`.
2. `bash $QA/qa-env.sh status` — confirm exactly one instance.
3. Open the Cline panel.
4. Record whether you landed on onboarding or straight in chat.
5. **Bring my own API key** → **Continue**.
6. In the **API Provider** field, type a partial name a real user would type (for Anthropic, type `claude`; for
   OpenAI, `gpt`). Record whether the provider is findable that way.
7. Select the provider. Paste the credential. Confirm the field masks.
8. Select a model. If the list is fetched live, note whether it populated first.
9. Finish onboarding.
10. Confirm what was actually stored: `bash $QA/qa-env.sh state cold-<provider>`.
11. Send `Reply with exactly PONG and nothing else.`
12. Send `What word did you just say?`

**PASS IF** onboarding appeared on the empty data dir; the provider was findable by partial name; the credential
masked; `state` shows the provider and the model you chose; both messages got real replies; and the second reply
shows the first turn was in context.

**FAIL IF** any of: you landed in chat with no provider configured; a usable key produced an auth error; the
preselected default model is not one that provider serves (an immediate 404 is the tell); a reply never arrived and
nothing errored (wait 2 minutes before calling this); the second turn lost context; or `state` disagrees with what
you selected.

For `cline` and any other OAuth provider, additionally confirm the browser flow opens on `DISPLAY=:1`, completes,
and that cancelling it leaves the UI usable rather than stuck.

**Artifact** — video for `anthropic`, `openai-native`, `openrouter`, `gemini`, `cline`: start recording at the
provider dropdown, stop when the reply lands. Screenshot for the rest, showing the configured form and the reply.

---

## Case group A2 — Upgrade from legacy config

Cline used to keep credentials in `globalState.json` + `secrets.json`; they now live in `settings/providers.json`.
Migration runs on activation. The failure that matters is silent: nothing errors and a key, model or per-mode
selection is quietly gone.

List the shapes with `node $QA/seed-legacy-config.mjs --list` and run every one. Case id is `A2-<shape>`.

**Steps**

1. `bash $QA/qa-env.sh stop <previous-slug>`
2. Seed, then launch against the seeded directory:
   ```bash
   SLUG=mig-<shape>
   rm -rf /tmp/cline-qa/$SLUG && mkdir -p /tmp/cline-qa/$SLUG/workspace
   printf 'export const name = "john"\n' > /tmp/cline-qa/$SLUG/workspace/qa.txt
   node $QA/seed-legacy-config.mjs --shape <shape> --dir /tmp/cline-qa/$SLUG/data --force
   ```
   Then check headlessly what migration will produce, before opening the UI:
   ```bash
   bun $QA/run-migration.ts /tmp/cline-qa/$SLUG/data
   ```
3. Launch. Because the directory already exists, use `qa-env.sh start` on a different slug only if you need a
   clean one; otherwise launch is the same command and `start` will recreate the directory, so seed **after**
   `start` if you prefer — but always confirm with `state` that the seeded files are the ones in play.
4. Open the Cline panel.
5. `bash $QA/qa-env.sh state $SLUG`
6. Send `Reply with exactly PONG.`

**PASS IF** all four hold: the UI opens on the provider from the legacy config with the legacy model and a masked
key present (not the default provider, not an empty model, not onboarding); `providers.json` contains the entry
with `"tokenSource": "migration"` and matching key, model and base URL; the message reaches the provider the legacy
config named (with a placeholder key, an auth error naming the *right* provider is a pass, one naming a different
provider is a failure); and for the `many-keys` shape all nine credentials migrated while the selection stayed on
`gemini`.

Then these re-entrancy cases, ids `A2-idempotent`, `A2-no-clobber`, `A2-partial`, `A2-corrupt`:

- **Idempotent.** Stop, start again against the same data dir. `providers.json` must not gain duplicates or change
  values.
- **No clobber.** Change the model in the UI, stop, start again. Your edit must win. An upgrade that resurrects an
  old model id every restart is the worst outcome here.
- **Partial.** Delete the model id key from `globalState.json`, delete `providers.json`, restart. Expect the
  provider selected with a sane default, not a blank dropdown.
- **Corrupt.** Write `{` into `globalState.json` and restart. Expect an unconfigured provider and a readable
  message, not a broken webview.

### A2-known — a finding to confirm, not discover

This already reproduces headlessly. Confirm it and include it in your report with the UI behaviour filled in.

```bash
node $QA/seed-legacy-config.mjs --shape split-plan-act --dir /tmp/cline-qa/split/data --force
bun $QA/run-migration.ts /tmp/cline-qa/split/data
```

Seeded: plan = anthropic / `claude-opus-4-1-20250805`, act = openrouter / `z-ai/glm-4.6`, `mode: "plan"`. Both
providers migrate and both keys survive, but the OpenRouter entry comes out holding the catalog default instead of
`z-ai/glm-4.6`. `migrateLegacyProviderSettings` reads one `mode` from `globalState.mode` and applies it to every
candidate provider, so `resolveModelForProvider` looks up `planModeOpenRouterModelId`, finds nothing, and falls
through to `getDefaultModelForProvider`.

What you add: launch against that directory, switch to Act mode, send a message, and record **which model the
request actually used** and whether the user was told their model changed.

---

## Report

Return exactly this JSON, then a short prose summary of anything the schema cannot express.

```json
{
  "run": "A",
  "environment": { "doctorClean": true, "notes": "" },
  "credentials": { "usable": [], "unusable": [], "notProvided": [] },
  "cases": [
    { "id": "A1-anthropic", "status": "pass|fail|blocked|skipped",
      "observed": "", "evidence": "", "artifact": "" }
  ],
  "findings": [
    { "id": "F1", "severity": "high|medium|low", "summary": "",
      "repro": [], "expected": "", "actual": "", "evidence": "", "suspectedFile": "" }
  ]
}
```

`evidence` must be a terminal output snippet or an artifact path, never a recollection. Every provider you could
not test belongs in `notProvided` or as a `skipped` case with a reason.
