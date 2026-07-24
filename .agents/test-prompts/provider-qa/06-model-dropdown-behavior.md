# QA 06 — Model dropdowns populate, search, and remember what you typed

You are testing the model pickers. Two halves:

- Providers that fetch their model list at runtime must actually populate it, filter it, and commit the choice.
- Providers that accept a free-text model id must keep exactly what the user typed, across reloads and provider
  switches.

The second half is where the silent failure lives: a custom model id replaced by a catalog default looks like
nothing happened, and the user's next request goes to a model they did not choose.

Owning code:

- `apps/vscode/webview-ui/src/components/settings/common/ModelSelector.tsx`, `ModelAutocomplete.tsx`,
  `ModelInfoView.tsx`
- Dedicated pickers: `OpenRouterModelPicker.tsx`, `RequestyModelPicker.tsx`, `OllamaModelPicker.tsx`,
  `GroqModelPicker.tsx`, `BasetenModelPicker.tsx`, `HuggingFaceModelPicker.tsx`, `VercelModelPicker.tsx`,
  `ClineModelPicker.tsx`, `SapAiCoreModelPicker.tsx`, `HicapModelPicker.tsx`, `OcaModelPicker.tsx`
- `providers/ModelPickerWithManualEntry.tsx` — the free-text path
- `apps/vscode/src/core/controller/models/refresh*Models.ts` — the extension-side fetchers
- `sdk/packages/core/src/services/llms/provider-defaults.ts` — `resolveProviderConfig`, plus the private fetchers
  for `litellm`, `baseten`, `hicap`, `poolside`
- `apps/vscode/src/core/controller/models/providerSwitchNormalization.ts` — the prime suspect when a custom id gets
  replaced

## Setup

```bash
export QA=/tmp/cline-qa/dropdowns
rm -rf "$QA" && mkdir -p "$QA/data/settings" "$QA/workspace"

cd /workspace/apps/vscode && bun run build:webview && bun esbuild.mjs

# Serves a /v1/models list of ~19 entries, so you can test list behaviour with no credentials.
tmux -f /exec-daemon/tmux.portal.conf new-session -d -s fault-proxy -- \
  node /workspace/.agents/test-prompts/provider-qa/fixtures/fault-proxy.mjs

tmux -f /exec-daemon/tmux.portal.conf new-session -d -s vscode-dropdowns -- \
  env DISPLAY=:1 CLINE_DATA_DIR="$QA/data" \
  code --no-sandbox --user-data-dir="$QA/vscode-userdata" \
       --extensionDevelopmentPath=/workspace/apps/vscode "$QA/workspace"
```

Settings → **API Configuration**. The provider dropdown is the field labelled *API Provider* with the placeholder
*Search and select provider…*.

## Part 1 — Live-fetched model lists

Test each of these with a credential where one is required. `openrouter`, `requesty`, `litellm` and `ollama` are
the four called out as most important; the rest share the same machinery and are cheap to add.

`openrouter`, `requesty`, `litellm`, `ollama`, `lmstudio`, `groq`, `baseten`, `huggingface`, `vercel-ai-gateway`,
`cline`, `oca`, `hicap`, `vscode-lm`.

Per provider:

1. Select the provider with no credential entered. The model area should say what is missing — not sit on a
   spinner, and not show an empty list with no explanation.
2. Enter the credential (or start the local server). The list must populate. Record roughly how many entries and
   how long it took; a list of two when the provider serves hundreds is a finding.
3. Search. Type a substring that should match several models and confirm filtering is live and case-insensitive.
   Type something that matches nothing and confirm you get an empty-state message rather than a blank box.
4. Keyboard: arrow keys move the highlight, Enter selects, Escape closes without changing the selection.
5. Select a model and confirm the model info panel updates to that model — context window, pricing, capabilities.
   A stale info panel means the selection and the displayed metadata have diverged.
6. Where there is an explicit refresh control, use it and confirm the list actually refetches.
7. Reload the window and confirm the list repopulates and the selection is still there.

**Ollama and LM Studio specifically.** Start with the server running, confirm the list populates. Then stop the
server and reopen the picker: you want an actionable empty state. Then point the base URL at
`http://127.0.0.1:8788` (the fault proxy serves `/v1/models`) and confirm a custom base URL is honoured.

**Failure injection for the fetchers.** Point LiteLLM or an OpenAI Compatible provider at a base URL that returns
an error and confirm the picker reports the fetch failure. A silent empty list here is indistinguishable, to the
user, from "this provider has no models".

## Part 2 — Free-text and custom model ids

This is the half that must survive a reload.

1. Select **OpenAI Compatible**, base URL `http://127.0.0.1:8788/v1`, any key. Type the model id `fault/ok`
   manually rather than picking it. Send a message; confirm `tail -1 /tmp/fault-proxy.jsonl` shows
   `"model": "fault/ok"`.
2. Now type a model id that exists in no catalog anywhere — `my-org/private-model-v3`. Reload the window. It must
   come back verbatim.
3. Switch to another provider and back. It must still be there.
4. Restart VS Code entirely. Still there.
5. Do the same on the other providers that accept manual entry (LiteLLM, Ollama with a model not in the local list,
   the generic catalog-driven forms). Any provider that quietly rewrites the id to a catalog default is a bug —
   check `providerSwitchNormalization.ts` when you find one.
6. Edge cases in the id itself: a very long id, one containing `/` and `:` and `.`, one with leading/trailing
   whitespace (should be trimmed), and the empty string (should be rejected with a message, not saved as empty).

## Part 3 — The provider dropdown itself

- Search by partial name, and by a name that differs from the id (searching "claude" should surface Anthropic;
  searching "gpt" should surface OpenAI).
- Clear the search with the × button and confirm the current provider is still selected underneath.
- Arrow-key through the whole list and confirm scrolling follows the highlight.
- Confirm every provider in the list actually renders a settings form when selected — an option that selects to a
  blank panel is a broken registry entry.

## Artifacts

- One video: OpenRouter's list populating, being searched, and a model being selected, with the info panel
  updating.
- One video: typing a custom model id, reloading the window, and the id still being there — ending on the proxy log
  proving the request used it.
- Screenshots of any empty or stuck list, with the provider and credential state visible.

## Report

A table of provider, list populated (Y/N + count), search works, selection commits, survives reload. Then a
separate list of every provider whose custom model id did not survive, since those are the silent ones.
