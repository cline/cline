# QA 02 — Every provider config option is actually functional

You are testing the fields inside each provider's settings form. A field is only functional if it does all three of
these: accepts input, survives a round trip through storage, and changes the request that goes to the provider. The
common bug is a field that does the first two and not the third — it looks configured, and it is being ignored.

So the method here is not "type in the box and check the box still has the text in it". It is "type in the box,
then read the request the provider received".

Owning code:

- `apps/vscode/webview-ui/src/components/settings/ApiOptions.tsx` — the provider switch
- `apps/vscode/webview-ui/src/components/settings/providers/` — one component per provider
- `apps/vscode/webview-ui/src/components/settings/providers/providerSettingsRegistry.ts` — which providers get a
  dedicated form vs. the catalog-driven `GenericProviderSettings`
- `apps/vscode/webview-ui/src/components/settings/utils/useApiConfigurationHandlers.ts` — the write path

## Setup

```bash
export QA=/tmp/cline-qa/config-options
rm -rf "$QA" && mkdir -p "$QA/data/settings" "$QA/workspace"
printf 'export const name = "john"\n' > "$QA/workspace/qa.txt"

cd /workspace/apps/vscode && bun run build:webview && bun esbuild.mjs

# The wire observer. Leave it running; every request is echoed to stdout and appended to the log.
tmux -f /exec-daemon/tmux.portal.conf new-session -d -s fault-proxy -- \
  node /workspace/.agents/test-prompts/provider-qa/fixtures/fault-proxy.mjs

tmux -f /exec-daemon/tmux.portal.conf new-session -d -s vscode-config -- \
  env DISPLAY=:1 CLINE_DATA_DIR="$QA/data" \
  code --no-sandbox --user-data-dir="$QA/vscode-userdata" \
       --extensionDevelopmentPath=/workspace/apps/vscode "$QA/workspace"
```

Open the Cline panel, go to Settings → **API Configuration**, choose **OpenAI Compatible**, and point it at
`http://127.0.0.1:8788/v1` with any non-empty API key and model `fault/ok`.

Read what the provider received with:

```bash
tail -1 /tmp/fault-proxy.jsonl | python3 -m json.tool
```

That gives you the full URL path, every header, and the exact JSON body — which is your ground truth for whether a
setting took effect.

## The check that every field gets

For each field below: set a distinctive value, send a message, and find that value in the logged request. Then
close and reopen Settings and confirm the field still reads back. A field that reads back but never appears on the
wire is a bug, and is the specific thing this prompt exists to find.

## Fields to cover

**OpenAI Compatible** — the richest form, and the one you can fully verify against the proxy.

- Base URL. Point it at `http://127.0.0.1:8788/v1`, confirm the proxy logs the request; then break it to
  `http://127.0.0.1:8788/wrong` and confirm you get a readable 404 rather than a hang.
- Custom headers. Add two (`X-Tenant: qa`, `X-Trace: 12345`). Both must appear in the logged `headers`. Then delete
  one and confirm it stops being sent — removal is where header editors usually leak.
- Model ID free-text entry. Type `fault/big-usage`; the logged `body.model` must match exactly.
- Request timeout. Set it to 3 seconds, switch the model to `fault/hang`, and send. You should get a timeout error
  at roughly 3s, not an indefinite spinner.
- Azure API version, when the form exposes it — it should show up in the request URL's query string.
- Any max-tokens / temperature / context-window overrides the form exposes must appear in `body`.

**Reasoning controls.** Set thinking budget or reasoning effort on a provider that supports it and confirm the
value lands in the request body. Then switch provider away and back, and check it did not silently reset.

**Local providers.** Ollama and LM Studio base URL fields: point Ollama at `http://127.0.0.1:8788` and confirm the
proxy sees the model-list poll. Then point it somewhere dead and confirm the form says so instead of spinning.

**Regional and mode switches.** The `china` / `international` toggles on Qwen, Moonshot, Z AI and MiniMax change
the API base. Flip each and confirm the resolved base URL changes in the form (and in `providers.json`). Same for
the SAP AI Core orchestration-mode toggle and the OCA internal/external mode.

**AWS Bedrock.** Region, profile vs. credentials vs. API key authentication, cross-region inference, global
inference, prompt cache, and custom endpoint. You can verify persistence and form behaviour without AWS access;
mark the on-the-wire half as untested if you have no credentials.

**Plan/Act separation.** Enable *Use different models for Plan and Act modes* in API Configuration. Set a different
provider and model per tab. Confirm each mode's request goes where its tab said. Then disable the checkbox and
confirm the two configurations converge in a defined way rather than one silently overwriting the other.

**Generic (catalog-driven) providers.** Pick three that render through `GenericProviderSettings` — for example
`deepseek`, `groq`, `together` — and confirm the generated form actually writes every field it renders. These are
generated rather than hand-written, so an unwired field is easy to miss.

## Cross-cutting traps to check explicitly

- Switch provider A → B → A. Every field you set on A must come back. Losing state on the round trip is the single
  most common report in this area.
- Set a field, then reload the window (`Developer: Reload Window`) without closing Settings. The field must survive.
- Leave a field mid-edit (focused, unblurred) and navigate away. Confirm the value is either committed or clearly
  discarded — not committed-on-some-paths.
- Paste a key with trailing whitespace or a newline. It should be trimmed, and it must not produce an auth failure
  that the user has no way to diagnose.
- Enter obviously invalid input (a base URL with no scheme, a negative timeout) and confirm you get validation, not
  a failed request twenty seconds later.

## Artifacts

- One video showing a header and a base URL being set, a message being sent, and the proxy log showing both on the
  wire.
- One screenshot of a provider form fully populated, next to the matching `providers.json`.
- A table in your report: field, provider, persisted?, on the wire?

## Report

List every field you exercised with its three-way result. Call out separately any field that persists but never
reaches the provider, since that is invisible to users and the highest-value finding here.
