/**
 * Config & Signal Helpers
 *
 * Provider configuration resolution, abort signal management,
 * and API timeout utilities for the Agent class.
 */

import * as LlmsProviders from "@clinebot/llms";
import type { AgentConfig, BasicLogger } from "../types";

// =============================================================================
// Provider Config Resolution
// =============================================================================

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

// =============================================================================
// Abort Signal Utilities
// =============================================================================

export function serializeAbortReason(reason: unknown): unknown {
	if (reason instanceof Error) {
		return {
			name: reason.name,
			message: reason.message,
			stack: reason.stack,
		};
	}
	return reason;
}

export type ApiTimeoutHandle = {
	signal: AbortSignal;
	/** Cancel the timeout early (e.g. once the turn completes successfully). */
	cancel: () => void;
};

export function createApiTimeoutSignal(
	timeoutMs: number,
): ApiTimeoutHandle | undefined {
	if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
		return undefined;
	}

	const controller = new AbortController();
	const timer = setTimeout(() => {
		controller.abort(new Error(`API request timed out after ${timeoutMs}ms`));
	}, timeoutMs);
	// Unref so the timer doesn't block process exit if it's still pending.
	if (typeof (timer as NodeJS.Timeout).unref === "function") {
		(timer as NodeJS.Timeout).unref();
	}
	return {
		signal: controller.signal,
		cancel: () => clearTimeout(timer),
	};
}

export function mergeAbortSignals(
	...signals: (AbortSignal | undefined)[]
): AbortSignal {
	const activeSignals = signals.filter(
		(signal): signal is AbortSignal => !!signal,
	);
	if (activeSignals.length === 0) {
		return new AbortController().signal;
	}
	if (activeSignals.length === 1) {
		return activeSignals[0];
	}

	const abortSignalCtor = AbortSignal as unknown as {
		any?: (signals: AbortSignal[]) => AbortSignal;
	};
	if (abortSignalCtor.any) {
		return abortSignalCtor.any(activeSignals);
	}

	const controller = new AbortController();
	for (const signal of activeSignals) {
		if (signal.aborted) {
			controller.abort(signal.reason);
			break;
		}
		signal.addEventListener("abort", () => controller.abort(signal.reason), {
			once: true,
		});
	}
	return controller.signal;
}

export function observeAbortSignal(
	signal: AbortSignal | undefined,
	source: string,
	runId: string,
	context: {
		agentId: string;
		getConversationId: () => string;
		log: (
			level: "debug" | "info" | "warn" | "error",
			message: string,
			metadata?: Record<string, unknown>,
		) => void;
	},
): void {
	if (!signal) {
		return;
	}
	if (signal.aborted) {
		context.log("warn", "Agent abort signal already aborted", {
			agentId: context.agentId,
			conversationId: context.getConversationId(),
			runId,
			source,
			reason: serializeAbortReason(signal.reason),
		});
		return;
	}
	signal.addEventListener(
		"abort",
		() => {
			context.log("warn", "Agent abort signal fired", {
				agentId: context.agentId,
				conversationId: context.getConversationId(),
				runId,
				source,
				reason: serializeAbortReason(signal.reason),
			});
		},
		{ once: true },
	);
}
