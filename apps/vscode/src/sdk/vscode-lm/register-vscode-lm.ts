// Registers the VS Code Language Model handler with the Cline SDK.
//
// The SDK's `@cline/llms` factory registry (registerHandler) exists for
// providers that need host-only dependencies — here, the `vscode` module /
// `vscode.lm` API — which cannot live in the SDK package. Once registered,
// `createHandler({ providerId: "vscode-lm", ... })` returns this handler, and
// the agent runtime resolves "vscode-lm" through the same registry, so both the
// main task loop and standalone utility calls use the VS Code LM API.
//
// The `vscode.lm` API only exists in VS Code and derivatives. On other hosts
// (e.g. JetBrains, which runs the shared activation path through a `vscode`
// shim) it is absent, so registration is gated on the API being present.

import { type ModelCollection, registerHandler, registerProvider } from "@cline/llms"
import * as vscode from "vscode"
import { Logger } from "@/shared/services/Logger"
import { VsCodeLmHandler } from "./vscode-lm-handler"

export const VSCODE_LM_PROVIDER_ID = "vscode-lm"

// Catalog entry so the provider shows up in `listProviders` (and therefore the
// settings dropdown). The SDK's builtin catalog cannot ship this provider —
// it depends on the host-only `vscode.lm` API — so the extension registers it
// as an out-of-the-box host provider at activation, mirroring how the handler
// itself is registered.
//
// Notes on the fields:
// - `name` is suffixed with "(VS Code LM)" because the generated builtin
//   catalog already contains a distinct `github-copilot` provider (models.dev,
//   API-key based) whose display name is plain "GitHub Copilot".
// - `models` is empty on purpose: available models are dynamic per user
//   (vscode.lm.selectChatModels) and the dedicated VSCodeLmProvider settings
//   component fetches them via the getVsCodeLmModels RPC, storing the choice
//   as a LanguageModelChatSelector rather than a catalog model id.
// - `defaultModelId` is empty on purpose. The handler parses modelId as a
//   `vendor/family` selector string, and an empty string parses to an empty
//   selector, which `vscode.lm.selectChatModels` treats as "any available
//   model" — the only safe default for a catalog whose models are dynamic.
//   Any non-empty placeholder here (e.g. "vscode-lm") would parse to a vendor
//   filter that matches nothing if a fallback path ever commits it.
// - `client: "custom"` — inference is routed through the host handler
//   registered below, never through an SDK gateway client.
export const VSCODE_LM_PROVIDER_COLLECTION: ModelCollection = {
	provider: {
		id: VSCODE_LM_PROVIDER_ID,
		name: "GitHub Copilot (VS Code LM)",
		description: "Models exposed by the VS Code Language Model API, e.g. GitHub Copilot.",
		defaultModelId: "",
		client: "custom",
		source: "system",
	},
	models: {},
}

/**
 * Whether the host exposes the VS Code Language Model API. False on hosts
 * without `vscode.lm` (e.g. JetBrains / standalone), where the provider must not
 * be registered or surfaced.
 */
export function isVsCodeLmApiAvailable(): boolean {
	return typeof vscode.lm?.selectChatModels === "function"
}

// Registration is process-global (the SDK registry is a module singleton), so a
// module-local flag guards against redundant re-registration on reload.
let registered = false

/**
 * Register the VS Code LM handler factory, once, when the `vscode.lm` API is
 * available. No-ops on hosts without the API and on repeated activation.
 */
export function registerVsCodeLmHandler(): void {
	if (registered || !isVsCodeLmApiAvailable()) {
		return
	}
	registerProvider(VSCODE_LM_PROVIDER_COLLECTION)
	registerHandler(VSCODE_LM_PROVIDER_ID, (config) => new VsCodeLmHandler(config))
	registered = true
	Logger.debug("[vscode-lm] Registered VS Code Language Model provider and handler with the SDK")
}
