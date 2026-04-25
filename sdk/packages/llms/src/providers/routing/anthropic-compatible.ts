import type {
	GatewayPromptCacheStrategy,
	GatewayProviderContext,
	GatewayProviderManifest,
	GatewayStreamRequest,
} from "@clinebot/shared";
import { createEphemeralCacheControl, toProviderOptionsKey } from "./utils";

/**
 * Anthropic-compatible routing precedence:
 * 1) `context.model.metadata.family` (contains "claude")
 * 2) `request.modelId` fallback heuristics
 *
 * Prompt-cache shaping is stricter: it only applies when the resolved model is
 * Anthropic-compatible AND provider metadata opts into
 * `promptCacheStrategy = "anthropic-automatic"`.
 */

export function resolveModelFamily(
	context: GatewayProviderContext,
): string | undefined {
	const family = context.model.metadata?.family;
	return typeof family === "string" ? family : undefined;
}

export function isAnthropicCompatibleModel(options: {
	modelId?: string;
	family?: string;
}): boolean {
	const family =
		typeof options.family === "string" ? options.family.trim() : "";
	if (family) {
		return family.toLowerCase().includes("claude");
	}

	return isAnthropicCompatibleModelId(options.modelId);
}

export function isAnthropicCompatibleModelId(
	modelId: string | undefined,
): boolean {
	if (!modelId) {
		return false;
	}

	const normalized = modelId.toLowerCase();
	const hasAnthropicVendor =
		normalized.startsWith("anthropic/") ||
		normalized.startsWith("anthropic.") ||
		normalized.startsWith("anthropic--") ||
		normalized.includes("/anthropic/") ||
		normalized.includes(".anthropic.") ||
		normalized.includes("--anthropic--");
	const hasClaudeLineage =
		normalized.startsWith("claude-") ||
		normalized.includes("/claude-") ||
		normalized.includes(".claude-") ||
		normalized.includes("--claude-");

	return hasAnthropicVendor || hasClaudeLineage;
}

export function createPromptCacheProviderOptions(
	providerId: string,
	includeAnthropic: boolean,
) {
	const providerOptions: Record<string, unknown> = {
		openaiCompatible: createEphemeralCacheControl(),
		[providerId]: createEphemeralCacheControl(),
	};

	const providerOptionsKey = toProviderOptionsKey(providerId);
	if (providerOptionsKey !== providerId) {
		providerOptions[providerOptionsKey] = createEphemeralCacheControl();
	}
	if (includeAnthropic) {
		providerOptions.anthropic = createEphemeralCacheControl();
	}

	return providerOptions;
}

export function applyPromptCacheToLastTextPart(
	message: Record<string, unknown> | undefined,
	providerId: string,
	includeAnthropic: boolean,
): void {
	if (!message) {
		return;
	}

	const content = message.content;
	if (typeof content === "string") {
		message.content = [
			{
				type: "text",
				text: content,
				providerOptions: createPromptCacheProviderOptions(
					providerId,
					includeAnthropic,
				),
			},
		];
		return;
	}

	if (!Array.isArray(content)) {
		return;
	}

	for (let i = content.length - 1; i >= 0; i--) {
		const part = content[i];
		if (
			part &&
			typeof part === "object" &&
			(part as { type?: unknown }).type === "text"
		) {
			content[i] = {
				...(part as Record<string, unknown>),
				providerOptions: createPromptCacheProviderOptions(
					providerId,
					includeAnthropic,
				),
			};
			return;
		}
	}
}

export function shouldUseAnthropicPromptCache(
	request: GatewayStreamRequest,
	context: GatewayProviderContext,
): boolean {
	return (
		isAnthropicCompatibleModel({
			modelId: request.modelId,
			family: resolveModelFamily(context),
		}) && resolvePromptCacheStrategy(context.provider) === "anthropic-automatic"
	);
}

export function resolvePromptCacheStrategy(
	provider: GatewayProviderManifest,
): GatewayPromptCacheStrategy | undefined {
	const strategy = provider.metadata?.promptCacheStrategy;
	return strategy === "anthropic-automatic" ? strategy : undefined;
}

export function buildAnthropicProviderOptions(
	request: GatewayStreamRequest,
	context: GatewayProviderContext,
) {
	const wantsAnthropicThinking =
		request.reasoning?.enabled === true ||
		request.reasoning?.effort !== undefined;

	return {
		...(wantsAnthropicThinking ? { thinking: { type: "adaptive" } } : {}),
		...(request.reasoning?.effort ? { effort: request.reasoning.effort } : {}),
		...(shouldUseAnthropicPromptCache(request, context)
			? createEphemeralCacheControl()
			: {}),
	};
}

export function resolveAnthropicCompatibleReasoningBudget(options: {
	modelId?: string;
	family?: string;
	effort?: string;
	maxTokens?: number;
	explicitBudgetTokens?: number;
}) {
	if (
		typeof options.explicitBudgetTokens === "number" &&
		options.explicitBudgetTokens > 0
	) {
		return options.explicitBudgetTokens;
	}

	if (
		(!options.modelId && !options.family) ||
		!isAnthropicCompatibleModel({
			modelId: options.modelId,
			family: options.family,
		}) ||
		!options.effort ||
		typeof options.maxTokens !== "number" ||
		options.maxTokens <= 1024
	) {
		return undefined;
	}

	const ratios: Record<string, number> = {
		low: 0.2,
		medium: 0.5,
		high: 0.8,
	};
	const ratio = ratios[options.effort];
	if (!ratio) {
		return undefined;
	}

	const maxBudget = Math.min(options.maxTokens - 1, 128000);
	return Math.max(1024, Math.floor(maxBudget * ratio));
}

export function buildAnthropicCompatibleReasoningOptions(
	request: GatewayStreamRequest,
	context: GatewayProviderContext,
) {
	if (
		!isAnthropicCompatibleModel({
			modelId: request.modelId,
			family: resolveModelFamily(context),
		}) ||
		(!request.reasoning?.enabled &&
			!request.reasoning?.effort &&
			typeof request.reasoning?.budgetTokens !== "number")
	) {
		return undefined;
	}

	const budgetTokens = resolveAnthropicCompatibleReasoningBudget({
		modelId: request.modelId,
		family: resolveModelFamily(context),
		effort: request.reasoning?.effort,
		maxTokens: request.maxTokens,
		explicitBudgetTokens: request.reasoning?.budgetTokens,
	});
	const reasoning: Record<string, unknown> = {};

	if (request.reasoning?.enabled === true) {
		reasoning.enabled = true;
	}
	if (typeof budgetTokens === "number" && budgetTokens >= 0) {
		reasoning.max_tokens = budgetTokens;
	} else if (request.reasoning?.effort) {
		reasoning.effort = request.reasoning.effort;
	} else if (request.reasoning?.budgetTokens === 0) {
		reasoning.max_tokens = 0;
	}

	return Object.keys(reasoning).length > 0 ? reasoning : undefined;
}

export function buildGatewayReasoningOptions(
	request: GatewayStreamRequest,
	context: GatewayProviderContext,
) {
	if (
		!request.reasoning?.enabled &&
		!request.reasoning?.effort &&
		typeof request.reasoning?.budgetTokens !== "number"
	) {
		return undefined;
	}

	const budgetTokens = isAnthropicCompatibleModel({
		modelId: request.modelId,
		family: resolveModelFamily(context),
	})
		? resolveAnthropicCompatibleReasoningBudget({
				modelId: request.modelId,
				family: resolveModelFamily(context),
				effort: request.reasoning?.effort,
				maxTokens: request.maxTokens,
				explicitBudgetTokens: request.reasoning?.budgetTokens,
			})
		: request.reasoning?.budgetTokens;

	const reasoning: Record<string, unknown> = {
		...(request.reasoning?.enabled === true || request.reasoning?.effort
			? { enabled: true }
			: {}),
		...(request.reasoning?.effort ? { effort: request.reasoning.effort } : {}),
	};

	if (typeof budgetTokens === "number" && budgetTokens >= 0) {
		reasoning.max_tokens = budgetTokens;
	}

	return Object.keys(reasoning).length > 0 ? reasoning : undefined;
}
