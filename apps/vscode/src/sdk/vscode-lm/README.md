# VS Code Language Model provider (`vscode-lm`)

Routes Cline inference through the [VS Code Language Model API](https://code.visualstudio.com/api/extension-guides/language-model)
(`vscode.lm`), letting Cline use models provided by other extensions such as
GitHub Copilot. VS Code only — the `vscode.lm` API does not exist on other hosts
(e.g. JetBrains), so the provider is gated on the API being present.

## Files

- **`vscode-lm-handler.ts`** — `VsCodeLmHandler`, a Cline SDK `ApiHandler`
  (`@cline/llms`) backed by `vscode.lm`. Selects a chat model, streams the
  response, forwards tool definitions, and surfaces tool calls and usage.
- **`vscode-lm-format.ts`** — converts SDK `Message`s to
  `vscode.LanguageModelChatMessage`s and back-converts tool results.
- **`register-vscode-lm.ts`** — registers the handler with the SDK handler
  registry and exposes the `vscode.lm` availability check used for gating.

## How it plugs into the SDK

The SDK's `@cline/llms` handler registry (`registerHandler`) exists for providers
that need host-only dependencies — here, `vscode.lm` — which cannot live in the
host-agnostic SDK package. `registerVsCodeLmHandler()` (called during extension
activation) registers the factory for the `vscode-lm` provider id when the API is
available. The SDK then resolves `vscode-lm` to this handler for both the main
task loop and standalone utility calls.

## Model selection

`ProviderConfig` has no field for a VS Code LM selector, so the selected model
travels as a `vendor/family[/version/id]` string in `ProviderConfig.modelId` —
the model-id channel the rest of the SDK adapter uses. The webview stores the
structured `LanguageModelChatSelector` in
`plan/actModeVsCodeLmModelSelector`; the session factory stringifies it into
`modelId`, and `parseVsCodeLmSelector` reads it back into a selector here.

## Tool calling

Tool definitions are passed to `sendRequest` via `LanguageModelChatRequestOptions.tools`
(with `toolMode: Auto`). Tool invocations arrive as `LanguageModelToolCallPart`
and are forwarded as tool-call chunks the SDK runtime executes.

Tool results round-trip as `LanguageModelToolResultPart`. Two details the VS Code
LM API requires:

- **Result content is serialized to text.** SDK tool executors return rich,
  untyped result objects (e.g. `ToolOperationResult` `{ query, result, success }`),
  not typed text blocks; `extractToolOutputText` pulls their text out so the model
  receives the actual output.
- **The prompt must not end on a tool result.** Copilot models require the final
  message to be a non-tool-result user message; when a turn ends on tool results,
  a short trailing user message is appended.
