/**
 * Build a concrete `LlmsProviders.ApiHandler` from an `AgentConfig`.
 *
 * @see PLAN.md §3.1 — moved from `packages/agents/src/utils/config-helpers.ts` lines 15–55.
 * @see PLAN.md §3.2.1 — `AgentConfig → AgentRuntimeConfig` mapping for
 *                      the `model` field.
 *
 * Pure port. Core calls this once per session (and again on
 * `updateConnection`) to produce the `AgentModel` adapter handed to
 * `new AgentRuntime({ model, ... })`.
 */

import * as LlmsProviders from "@clinebot/llms";
import type { AgentConfig, BasicLogger } from "@clinebot/shared";

export function resolveKnownModelsFromConfig(
	config: AgentConfig,
): Record<string, LlmsProviders.ModelInfo> | undefined {
	const pc = config.providerConfig as LlmsProviders.ProviderConfig | undefined;
	if (pc?.knownModels) {
		return pc.knownModels;
	}
	if (config.knownModels) {
		return config.knownModels;
	}
	return (
		LlmsProviders.MODEL_COLLECTIONS_BY_PROVIDER_ID[config.providerId]?.models ??
		undefined
	);
}

export function createHandlerFromConfig(
	config: AgentConfig,
	logger: BasicLogger | undefined,
): LlmsProviders.ApiHandler {
	const pc = config.providerConfig as LlmsProviders.ProviderConfig | undefined;
	const baseProviderConfig =
		pc?.providerId === config.providerId ? pc : undefined;
	const normalizedProviderConfig: LlmsProviders.ProviderConfig = {
		...(baseProviderConfig ?? {}),
		providerId: config.providerId,
		modelId: config.modelId,
		apiKey: config.apiKey ?? baseProviderConfig?.apiKey,
		baseUrl: config.baseUrl ?? baseProviderConfig?.baseUrl,
		headers: config.headers ?? baseProviderConfig?.headers,
		knownModels: resolveKnownModelsFromConfig(config),
		maxOutputTokens: config.maxTokensPerTurn,
		reasoningEffort: config.reasoningEffort,
		thinkingBudgetTokens: config.thinkingBudgetTokens,
		thinking: config.thinking,
		abortSignal: config.abortSignal,
		logger,
		extensionContext: config.extensionContext,
	};
	return LlmsProviders.createHandler(normalizedProviderConfig);
}
