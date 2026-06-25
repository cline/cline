// Replaces classic src/core/api buildApiHandler (see origin/main).
//
// Builds an SDK ApiHandler (from `@cline/llms`) directly from the extension's
// legacy ApiConfiguration. This is the single inference path: the main task
// loop runs through ClineCore (see cline-session-factory.ts), and standalone
// utility callers (commit message generation) use the handler
// returned here. Both share the same provider/model/key/baseUrl resolution so
// there is no second source of truth.

import { type ApiHandler, createHandler, type ProviderConfig } from "@cline/llms"
import type { ApiConfiguration } from "@shared/api"
import type { Mode } from "@shared/storage/types"
import { fetch } from "@/shared/net"
import { buildBedrockProviderConfig } from "./bedrock-config"
import { resolveApiKey, resolveBaseUrl, resolveModelId, resolveVertexProviderConfig } from "./cline-session-factory"
import { toSdkProviderId } from "./model-catalog/sdk-provider-id"

export interface BuildApiHandlerOptions {
	/**
	 * Disable extended thinking/reasoning for this handler. Standalone utility
	 * calls (commit message generation) want fast, cheap,
	 * deterministic completions and don't benefit from reasoning. When true we
	 * send `thinking: false` and omit both effort and budget so providers like
	 * OpenRouter don't receive a reasoning config at all.
	 */
	disableReasoning?: boolean
}

/**
 * Build an SDK `ProviderConfig` from the extension's `ApiConfiguration` for the
 * given mode (plan/act).
 *
 * Reuses the same resolvers the session factory uses to map the legacy config
 * onto provider id, model id, API key, and base URL, then converts the provider
 * id to the SDK's spelling (e.g. `openai` → `openai-compatible`).
 *
 * Reasoning handling: the SDK gateway forwards `reasoningEffort` as
 * `reasoning.effort` and `thinkingBudgetTokens` as `reasoning.max_tokens`.
 * Several providers (e.g. OpenRouter/Anthropic) reject a request that carries
 * BOTH. We therefore send at most one — preferring an explicit thinking budget
 * over effort — or none when reasoning is disabled.
 */
export function buildSdkProviderConfig(
	configuration: ApiConfiguration,
	mode: Mode,
	options?: BuildApiHandlerOptions,
): ProviderConfig {
	const providerId = (mode === "plan" ? configuration.planModeApiProvider : configuration.actModeApiProvider) ?? "cline"

	const apiKey = resolveApiKey(providerId, configuration)
	const modelId = resolveModelId(providerId, mode, configuration)
	const baseUrl = resolveBaseUrl(providerId, mode, configuration)

	const thinkingBudgetTokens =
		mode === "plan" ? configuration.planModeThinkingBudgetTokens : configuration.actModeThinkingBudgetTokens
	const reasoningEffort = mode === "plan" ? configuration.planModeReasoningEffort : configuration.actModeReasoningEffort

	const vertexProviderConfig = providerId === "vertex" ? resolveVertexProviderConfig(configuration) : undefined

	const base: ProviderConfig = {
		providerId: toSdkProviderId(providerId),
		modelId: modelId ?? "",
		apiKey: apiKey ?? "",
		baseUrl,
		...(vertexProviderConfig ?? {}),
		// Use the proxy-aware fetch so gateway providers respect corporate proxy
		// configuration (see .clinerules/network.md).
		fetch,
		onRetryAttempt: configuration.onRetryAttempt,
		// Bedrock needs its region + structured AWS auth options forwarded to the
		// SDK gateway. Without these, a pasted Bedrock API key / region is dropped.
		...(providerId === "bedrock" ? buildBedrockProviderConfig(configuration, mode) : {}),
	}

	if (options?.disableReasoning) {
		// Explicitly turn reasoning off; do not send effort or budget.
		return { ...base, thinking: false }
	}

	// Send at most one of budget/effort to avoid the "Only one of
	// reasoning.effort and reasoning.max_tokens can be specified" error.
	if (thinkingBudgetTokens && thinkingBudgetTokens > 0) {
		return { ...base, thinkingBudgetTokens }
	}
	if (reasoningEffort === "low" || reasoningEffort === "medium" || reasoningEffort === "high") {
		return { ...base, reasoningEffort }
	}
	return base
}

/**
 * Build an SDK-backed `ApiHandler` from the extension's `ApiConfiguration`.
 *
 * This is the SDK replacement for the legacy per-provider handler factory. The
 * returned handler implements the same `createMessage`/`getModel` surface, so
 * existing callers continue to work unchanged.
 */
export function buildApiHandler(configuration: ApiConfiguration, mode: Mode, options?: BuildApiHandlerOptions): ApiHandler {
	const providerConfig = buildSdkProviderConfig(configuration, mode, options)
	const handler = createHandler(providerConfig)
	const getModel = handler.getModel.bind(handler)

	handler.getModel = () => {
		return {
			...getModel(),
			providerId: providerConfig.providerId,
		}
	}

	return handler
}
