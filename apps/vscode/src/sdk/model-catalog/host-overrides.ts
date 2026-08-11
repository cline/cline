/**
 * Applies the `ModelInfo` fields the extension owns locally, on top of
 * an adapted SDK `ModelInfo`. Today this is Vertex's
 * `supportsGlobalEndpoint` allowlist (see `./vertex-global-endpoint.ts`),
 * Vertex's unknown-pricing cleanup, and Ollama's effective context window.
 *
 * Both the model-list resolution path (`resolveSdkModels`) and the
 * single-model lookup path (`resolveModelInfo`) pass adapted
 * `ModelInfo` through this function so the same UX guard rails apply
 * regardless of which RPC the webview uses. When the SDK adopts these
 * flags upstream, the override and this file can be removed together.
 */

import { OLLAMA_DEFAULT_CONTEXT_WINDOW } from "@cline/llms"
import type { ModelInfo } from "@shared/api"
import { StateManager } from "@/core/storage/StateManager"
import { getProviderSettingsManager } from "../provider-migration"
import type { ProviderId } from "./contracts"
import { vertexModelSupportsGlobalEndpoint } from "./vertex-global-endpoint"

/**
 * The context window Ollama actually applies is the requested `num_ctx`,
 * not the model's native maximum — Ollama truncates the prompt to it
 * server-side. Surface the user's "Model Context Window" setting (or the
 * request default) instead of catalog/safe-default values so the chat
 * indicator and context management match reality.
 */
function resolveOllamaContextWindow(): number {
	// providers.json (`contextWindow`) is the source of truth; the legacy
	// StateManager string is a migration fallback (the config store mirrors
	// writes to both).
	try {
		const value = getProviderSettingsManager().getProviderSettings("ollama")?.contextWindow
		if (typeof value === "number" && Number.isFinite(value) && value > 0) {
			return Math.floor(value)
		}
	} catch {
		// providers.json unavailable — fall through to the legacy state key.
	}
	try {
		const raw = StateManager.get().getApiConfiguration().ollamaApiOptionsCtxNum?.trim()
		if (raw) {
			const value = Number(raw)
			if (Number.isFinite(value) && value > 0) {
				return Math.floor(value)
			}
		}
	} catch {
		// StateManager unavailable (e.g. tests) — fall through to the default.
	}
	return OLLAMA_DEFAULT_CONTEXT_WINDOW
}

export function applyHostModelInfoOverrides(providerId: ProviderId, modelId: string, modelInfo: ModelInfo): ModelInfo {
	if (providerId === "vertex") {
		let result = modelInfo
		if (vertexModelSupportsGlobalEndpoint(providerId, modelId)) {
			result = { ...result, supportsGlobalEndpoint: true }
		}
		// Vertex has no free models, so a $0/$0 price pair is always the shape
		// adapter's safe default standing in for an SDK record that carries no
		// pricing (e.g. models billed region-dependently, where a single
		// universal price would be wrong). Drop the pair so the settings UI
		// shows no price instead of a misleading "Free".
		if (result.inputPrice === 0 && result.outputPrice === 0) {
			const { inputPrice: _unknownInputPrice, outputPrice: _unknownOutputPrice, ...withoutPricing } = result
			result = withoutPricing
		}
		return result
	}
	if (providerId === "ollama") {
		return { ...modelInfo, contextWindow: resolveOllamaContextWindow() }
	}
	return modelInfo
}
