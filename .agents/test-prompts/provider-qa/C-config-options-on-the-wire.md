# Provider QA C — Is every provider setting actually functional?

A settings field is only functional if it does three things: accepts input, survives a round trip through storage,
and changes the request that goes to the provider. The common bug is a field that does the first two and not the
third — it looks configured, and it is being ignored.

So the method here is not "type in the box and check the box still has the text in it". It is "type in the box,
then read the request the provider received". Almost all of this run needs no real credentials, because a local
endpoint that logs everything it receives is a better oracle than a real provider.

Report using the template at the bottom. Record video.

## Your credentials

Save this as `/tmp/qa-keys.json`. Most of this run works with none of them filled in; real keys only matter for the
handful of steps that say so.

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

```bash
cd /workspace
node .agents/test-prompts/provider-qa/fixtures/apply-keys.mjs --keys /tmp/qa-keys.json --list
```

## Environment

```bash
export QA=/tmp/cline-qa/config-options
rm -rf "$QA" && mkdir -p "$QA/workspace"
printf 'export const name = "john"\n' > "$QA/workspace/qa.txt"
cd /workspace/apps/vscode && bun run build:webview && bun esbuild.mjs   # only if dist/extension.js is stale

# The wire observer. Every inbound request is echoed to stdout and appended to the log.
tmux -f /exec-daemon/tmux.portal.conf new-session -d -s fault-proxy -- \
  node /workspace/.agents/test-prompts/provider-qa/fixtures/fault-proxy.mjs

tmux -f /exec-daemon/tmux.portal.conf new-session -d -s vscode-qa -- \
  env DISPLAY=:1 CLINE_DATA_DIR="$QA/data" \
  code --no-sandbox --disable-workspace-trust --user-data-dir="$QA/vscode-userdata" \
       --extensionDevelopmentPath=/workspace/apps/vscode "$QA/workspace"
```

Operational rules, learned the hard way:

- **One VS Code instance at a time.** A second `code` with the same `--user-data-dir` attaches to the first, so you
  can end up testing a window you did not configure. Check `ps -eo pid,args | grep [e]xtensionDevelopmentPath`.
- **Never `kill -9` VS Code.** It poisons the profile and later launches die with *"The window terminated
  unexpectedly (reason: 'crashed', code: '133')"*. Use `kill -TERM`.
- **On crash 133**, kill the process, `rm -rf "$QA/vscode-userdata"`, relaunch. If a plain `code` with no
  `--extensionDevelopmentPath` also crashes, the display is degraded — an environment failure, not a Cline bug.
- `--disable-workspace-trust` matters; without it Restricted Mode blocks command execution.

Open the Cline panel from the Activity Bar. On an empty data directory you get onboarding — **Bring my own API
key** → **Continue**. Afterwards the form is behind the gear icon in the Cline navbar; **Done** closes it. Choose
**OpenAI Compatible**, base URL `http://127.0.0.1:8788/v1`, any non-empty key, model `fault/ok`.

One trap before you start: the Model ID field is an autocomplete, and typing an id that is a strict prefix of
another commits the longer one — typing `fault/ok` leaves you on `fault/ok-no-cache`. Always read back the
committed value.

## Reading the wire

```bash
tail -1 /tmp/fault-proxy.jsonl | python3 -m json.tool
```

That gives you the full URL path, every header, and the exact JSON body. A confirmed-good baseline looks like:
`path` is `/v1/chat/completions`, `headers.authorization` is `Bearer <your key>`, `body.model` is the model you
selected, and `body.tools` lists `read_files`, `search_codebase`, `fetch_web_content`, `editor`, `ask_question`,
`attempt_completion`, `run_commands`.

## The check every field gets

Set a distinctive value → send a message → find that value in the logged request → close and reopen Settings and
confirm it reads back. A field that reads back but never appears on the wire is the finding this run exists for,
because it is completely invisible to users.

## Fields to cover

**OpenAI Compatible** is the richest form and the one you can fully verify.

- *Base URL.* Point at `http://127.0.0.1:8788/v1` and confirm the proxy logs the request. Then break it to
  `http://127.0.0.1:8788/wrong` and confirm a readable 404 rather than a hang.
- *Custom headers.* Add `X-Tenant: qa` and `X-Trace: 12345`; both must appear in the logged headers. Then delete
  one and confirm it stops being sent — removal is where header editors usually leak.
- *Model ID.* `body.model` must match exactly what the field committed.
- *Request timeout.* Set 3 seconds, switch the model to `fault/hang`, send. Expect a timeout error at roughly 3s,
  not an indefinite spinner.
- *Azure API version*, where exposed — should appear in the request URL's query string.
- Any max-tokens, temperature or context-window override the form exposes must appear in `body`.

**Reasoning controls.** Set thinking budget or reasoning effort on a provider that supports it and confirm the
value lands in the body. Then switch provider away and back and confirm it did not silently reset.

**Local providers.** Point Ollama's base URL at `http://127.0.0.1:8788` and confirm the proxy sees the model-list
poll. Then point it somewhere dead and confirm the form says so instead of spinning.

**Regional and mode switches.** The `china` / `international` toggles on Qwen, Moonshot, Z AI and MiniMax change
the API base — flip each and confirm the resolved base URL changes in the form and in `providers.json`. Same for
the SAP AI Core orchestration toggle and the OCA internal/external mode.

**AWS Bedrock.** Region, the three authentication modes, cross-region inference, global inference, prompt cache,
custom endpoint. Persistence and form behaviour are testable without AWS access; mark the on-the-wire half
untested if you have no credentials.

**Plan/Act separation.** Enable *Use different models for Plan and Act modes*, set a different provider and model
per tab, and confirm each mode's request goes where its tab said. Then disable the checkbox and confirm the two
configurations converge in a defined way rather than one silently overwriting the other.

**Generic catalog-driven providers.** Pick three that render through `GenericProviderSettings` — `deepseek`,
`groq`, `together` are good choices — and confirm every field the generated form renders is actually wired. These
are generated rather than hand-written, so an unwired field is easy to miss.

## Cross-cutting traps

- Switch provider A → B → A. Every field set on A must come back. Losing state on that round trip is the single
  most common report in this area.
- Set a field, then reload the window without closing Settings.
- Leave a field mid-edit (focused, never blurred) and navigate away. It should either commit or clearly discard —
  not commit on some paths only.
- Paste a key with trailing whitespace or a newline. It should be trimmed, not produce an undiagnosable auth
  failure.
- Enter invalid input (a base URL with no scheme, a negative timeout) and expect validation, not a failed request
  twenty seconds later.

## Artifacts

- One video: setting a custom header and a base URL, sending a message, and the proxy log showing both on the
  wire. This is the headline artifact.
- One screenshot of a fully populated provider form next to the matching `providers.json`.

## Report

A table: field, provider, persisted?, on the wire?. Call out separately every field that persists but never reaches
the provider.
