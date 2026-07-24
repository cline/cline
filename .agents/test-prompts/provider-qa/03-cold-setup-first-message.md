# QA 03 — Set up each provider from scratch and send a message

You are testing the path a brand-new user takes: no config on disk, pick a provider, paste a credential, pick a
model, get a reply. Every provider is tested from a genuinely empty state — not by switching providers inside an
already-configured install, because that hides the "works only if something else configured it first" class of bug.

This prompt needs real credentials. Use whichever you have; report the rest as untested rather than guessing.

Owning code:

- `apps/vscode/webview-ui/src/components/welcome/OnboardingView.tsx` and `sections/ApiConfigurationSection.tsx`
- `apps/vscode/webview-ui/src/components/settings/providers/` — per-provider forms
- `sdk/packages/llms/src/providers/` — the handlers that actually issue the request

## Setup, repeated per provider

The `rm -rf` matters. A fresh data directory *and* a fresh VS Code user-data directory per provider is what makes
this a cold-start test.

```bash
export P=anthropic                       # change per provider
export QA="/tmp/cline-qa/cold-$P"
rm -rf "$QA" && mkdir -p "$QA/data/settings" "$QA/workspace"
printf 'export const name = "john"\n' > "$QA/workspace/qa.txt"

tmux -f /exec-daemon/tmux.portal.conf new-session -d -s "vscode-cold-$P" -- \
  env DISPLAY=:1 CLINE_DATA_DIR="$QA/data" \
  code --no-sandbox --disable-workspace-trust --user-data-dir="$QA/vscode-userdata" \
       --extensionDevelopmentPath=/workspace/apps/vscode "$QA/workspace"
```

Build first if needed: `cd /workspace/apps/vscode && bun run build:webview && bun esbuild.mjs`.

## The sequence for one provider

1. Open the Cline panel with the Cline icon in the VS Code Activity Bar. With an empty data dir you should get
   onboarding, not the chat view. Note it if you don't — landing straight in chat with no provider is a bug on its
   own.
2. Choose **Bring my own API key**, then **Continue**. Select the provider from the **API Provider** search
   dropdown. Type to filter; confirm the provider is findable by a partial name a user would actually type.
3. Paste the credential. Confirm it masks.
4. Pick a model. For providers that fetch their list live, confirm the list populates before you pick — if it is
   empty, that is a finding for prompt 06 but note it here too. The Model ID field is an autocomplete, and typing a
   model id that is a prefix of another can commit the longer one, so read back the committed value.
5. Finish onboarding and land in chat.
6. Send: `Reply with exactly the single word PONG and nothing else.` You want a real completion, streamed into the
   chat, with the task header showing a token count.
7. Send a second message: `What word did you just say?` This catches providers where the first turn works and
   conversation history is not threaded correctly.
8. Confirm the task header shows a non-zero cost or a deliberate no-cost indicator, and the model name shown
   matches what you picked.

## Providers to cover, in priority order

**Tier 1 — most used, test all of these.** `cline` (OAuth sign-in rather than a key), `anthropic`, `openai-native`,
`openrouter`, `gemini`, `openai` (OpenAI Compatible against a real endpoint).

**Tier 2 — common, test if you have keys.** `deepseek`, `groq`, `xai`, `mistral`, `together`, `fireworks`,
`requesty`, `vercel-ai-gateway`, `baseten`, `cerebras`.

**Tier 3 — different auth or transport, worth the time because they break differently.** `bedrock` (AWS
credentials, profile, and cross-region), `vertex` (GCP project + region), `sapaicore` (client id/secret + token
URL), `litellm` (self-hosted base URL), `openai-codex` (OAuth, subscription billing), `vscode-lm` (no credential;
uses the host's language model API), `claude-code` and `qwen-code` (local CLI-backed).

**Tier 4 — local, no key needed, always testable.** `ollama` and `lmstudio`. If neither server is installed, say
so; do not fake it.

For OAuth providers (`cline`, `openai-codex`, `oca`) also confirm the sign-in flow opens a browser on `DISPLAY=:1`,
completes, and returns to a signed-in state — and that cancelling it leaves the UI usable rather than stuck.

## What counts as a failure

- Onboarding does not offer the provider, or the search does not find it by an obvious substring.
- A valid credential produces an authentication error.
- The default model preselected for the provider is not a model that provider actually serves. This is a real
  hazard: `apps/vscode/src/core/controller/models/providerSwitchNormalization.ts` snaps the model id on provider
  switch, and a wrong snap surfaces here as an immediate 404 from the provider.
- The reply never arrives and nothing errors. Wait two minutes before calling it a hang, then capture it.
- The second turn loses the first turn's context.
- The provider works but the chat header shows a different model or provider than you configured.

## Artifacts

- One video per tier-1 provider: empty state through to a streamed PONG. Start recording at the provider dropdown,
  stop as soon as the reply lands — these should be short.
- One screenshot per tier-2/3 provider showing the configured form and the successful reply in the same frame.

## Report

A table of provider, credential type, setup result, first message, second message, and the model actually used.
Explicitly list which providers you could not test and why. For each failure include the exact error text, the
model id you selected, and whether the request left the machine.
