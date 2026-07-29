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

import { registerHandler } from "@cline/llms"
import * as vscode from "vscode"
import { Logger } from "@/shared/services/Logger"
import { VsCodeLmHandler } from "./vscode-lm-handler"

export const VSCODE_LM_PROVIDER_ID = "vscode-lm"

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
	registerHandler(VSCODE_LM_PROVIDER_ID, (config) => new VsCodeLmHandler(config))
	registered = true
	Logger.debug("[vscode-lm] Registered VS Code Language Model handler with the SDK")
}
