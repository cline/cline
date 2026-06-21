// Replaces classic src/core/api buildApiHandler (see origin/main).
//
// Builds an SDK ApiHandler (from `@cline/llms`) from SDK provider settings.
// The main task loop runs through ClineCore (see cline-session-factory.ts), and
// standalone utility callers (commit message generation) use the handler
// returned here. Both share the same SDK-first provider config resolution so
// there is no second source of truth.

import { type ApiHandler, createHandler, type ProviderConfig } from "@cline/llms"
import type { ApiConfiguration } from "@shared/api"
import type { Mode } from "@shared/storage/types"
import { mirrorPlanActApiConfiguration } from "@/core/controller/models/sharedModeConfiguration"
import { fetch } from "@/shared/net"
import { buildRuntimeProviderConfig } from "./cline-session-factory"

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
 * Reads the SDK ProviderSettingsManager first, matching the CLI's ownership
 * model. Legacy ApiConfiguration is only a compatibility fallback for installs
 * that have not produced SDK provider settings yet. Plan/Act mode changes
 * runtime behavior and tool access, not the selected provider/model.
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
	const sharedConfiguration = mirrorPlanActApiConfiguration(configuration)
	const providerId =
		(mode === "plan" ? sharedConfiguration.planModeApiProvider : sharedConfiguration.actModeApiProvider) ?? "cline"
	const runtimeProviderConfig = buildRuntimeProviderConfig(providerId, mode, sharedConfiguration)
	const modelId = runtimeProviderConfig.modelId ?? ""

	const thinkingBudgetTokens =
		mode === "plan" ? sharedConfiguration.planModeThinkingBudgetTokens : sharedConfiguration.actModeThinkingBudgetTokens
	const reasoningEffort =
		mode === "plan" ? sharedConfiguration.planModeReasoningEffort : sharedConfiguration.actModeReasoningEffort

	const base: ProviderConfig = {
		...runtimeProviderConfig,
		modelId,
		// Use the proxy-aware fetch so gateway providers respect corporate proxy
		// configuration (see .clinerules/network.md).
		fetch,
		onRetryAttempt: configuration.onRetryAttempt,
	}

	if (options?.disableReasoning) {
		// Explicitly turn reasoning off; do not send effort or budget.
		const withoutReasoning = { ...base }
		delete withoutReasoning.reasoningEffort
		delete withoutReasoning.thinkingBudgetTokens
		return { ...withoutReasoning, thinking: false }
	}

	if (runtimeProviderConfig.thinking !== undefined || runtimeProviderConfig.reasoningEffort !== undefined) {
		return base
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
