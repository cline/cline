import type {
	GatewayModelRoute,
	GatewayPromptCacheStrategy,
	GatewayProviderContext,
	GatewayProviderManifest,
	GatewayProviderMetadata,
	GatewayStreamRequest,
} from "@cline/shared";
import {
	isAnthropicCompatibleModel,
	isQwenModel,
	modelReasoningDefaultsOn,
	modelRouteMatches,
	resolveModelFamily,
} from "../model-facts";
import { createEphemeralCacheControl, toProviderOptionsKey } from "./utils";

const ANTHROPIC_DEFAULT_THINKING_BUDGET_TOKENS = 1024;
const ANTHROPIC_MAX_THINKING_BUDGET_TOKENS = 128000;
const ANTHROPIC_REASONING_EFFORT_BUDGET_RATIOS: Record<string, number> = {
	low: 0.2,
	medium: 0.5,
	high: 0.8,
};

export type AnthropicReasoningRequestPolicy =
	| { kind: "none" }
	| { kind: "anthropic-manual" }
	| { kind: "anthropic-adaptive" };

/**
 * Provider metadata owns behavior routing. `anthropic-compatible` is one route
 * matcher for Claude/Anthropic lineage; prompt-cache and reasoning decide
 * independently whether they use it.
 */

const ANTHROPIC_COMPATIBLE_ROUTE: GatewayModelRoute = {
	matcher: "anthropic-compatible",
};

// Qwen cache support is model-specific; direct Dashscope/OpenRouter catalogs
// only match this route once their model metadata includes prompt-cache support.
const QWEN_PROMPT_CACHE_ROUTE: GatewayModelRoute = {
	matcher: "model-family",
	family: "qwen",
	requiredCapability: "prompt-cache",
};

function createAnthropicRoutingMetadata(options?: {
	promptCacheRoutes?: GatewayModelRoute[];
	reasoningRoutes?: GatewayModelRoute[];
}): GatewayProviderMetadata {
	const promptCacheRoutes: GatewayModelRoute[] = options?.promptCacheRoutes ?? [
		ANTHROPIC_COMPATIBLE_ROUTE,
	];
	const reasoningRoutes: GatewayModelRoute[] = options?.reasoningRoutes ?? [
		ANTHROPIC_COMPATIBLE_ROUTE,
	];
	return {
		routing: {
			...(promptCacheRoutes.length > 0
				? {
						promptCache: {
							format: "anthropic-cache-control",
							routes: promptCacheRoutes.map((route) => ({ ...route })),
						},
					}
				: {}),
			...(reasoningRoutes.length > 0
				? {
						reasoning: {
							format: "anthropic-thinking",
							routes: reasoningRoutes.map((route) => ({ ...route })),
						},
					}
				: {}),
		},
	};
}

export const ANTHROPIC_ROUTING_METADATA = createAnthropicRoutingMetadata();

export const QWEN_CACHE_ROUTING_METADATA = createAnthropicRoutingMetadata({
	promptCacheRoutes: [QWEN_PROMPT_CACHE_ROUTE],
	reasoningRoutes: [],
});

const KIMI_FOR_CODING_REASONING_ROUTE: GatewayModelRoute = {
	matcher: "model-family",
	family: "kimi-thinking",
};

const KIMI_K2_REASONING_ROUTE: GatewayModelRoute = {
	matcher: "model-family",
	family: "kimi-k2",
};

export const KIMI_FOR_CODING_ROUTING_METADATA = createAnthropicRoutingMetadata({
	promptCacheRoutes: [],
	reasoningRoutes: [KIMI_FOR_CODING_REASONING_ROUTE, KIMI_K2_REASONING_ROUTE],
});

export const ANTHROPIC_AND_QWEN_CACHE_ROUTING_METADATA =
	createAnthropicRoutingMetadata({
		promptCacheRoutes: [ANTHROPIC_COMPATIBLE_ROUTE, QWEN_PROMPT_CACHE_ROUTE],
	});

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
		const cachedContent: Record<string, unknown>[] = [
			{
				type: "text",
				text: content,
				providerOptions: createPromptCacheProviderOptions(
					providerId,
					includeAnthropic,
				),
			},
		];
		if (!includeAnthropic) {
			// Keep non-Anthropic OpenAI-compatible requests multipart so
			// cache_control remains on the content part instead of being collapsed
			// to message metadata. Anthropic rejects whitespace-only text blocks.
			cachedContent.push({ type: "text", text: " " });
		}
		message.content = cachedContent;
		return;
	}

	if (!Array.isArray(content)) {
		return;
	}

	const textPartCount = content.filter(
		(part) =>
			part &&
			typeof part === "object" &&
			(part as { type?: unknown }).type === "text",
	).length;

	for (let i = content.length - 1; i >= 0; i--) {
		const part = content[i];
		if (
			part &&
			typeof part === "object" &&
			(part as { type?: unknown }).type === "text"
		) {
			const needsFiller = textPartCount === 1 && !includeAnthropic;
			content[i] = {
				...(part as Record<string, unknown>),
				providerOptions: createPromptCacheProviderOptions(
					providerId,
					includeAnthropic,
				),
			};
			if (needsFiller) {
				content.push({ type: "text", text: " " });
			}
			return;
		}
	}
}

export function shouldApplyPromptCache(
	request: GatewayStreamRequest,
	context: GatewayProviderContext,
): boolean {
	return resolvePromptCacheRoute(request, context) !== undefined;
}

function shouldApplyAnthropicCacheBucket(
	request: GatewayStreamRequest,
	context: GatewayProviderContext,
): boolean {
	return (
		resolvePromptCacheRoute(request, context)?.matcher ===
		"anthropic-compatible"
	);
}

function resolveLegacyPromptCacheStrategy(
	provider: GatewayProviderManifest,
): GatewayPromptCacheStrategy | undefined {
	return provider.metadata?.promptCacheStrategy === "anthropic-automatic"
		? "anthropic-automatic"
		: undefined;
}

function resolveLegacyPromptCacheRoute(
	request: GatewayStreamRequest,
	context: GatewayProviderContext,
): GatewayModelRoute | undefined {
	if (
		resolveLegacyPromptCacheStrategy(context.provider) !== "anthropic-automatic"
	) {
		return undefined;
	}

	const family = resolveModelFamily(context);
	if (
		isAnthropicCompatibleModel({
			modelId: request.modelId,
			family,
		})
	) {
		return { matcher: "anthropic-compatible" };
	}

	// `promptCacheStrategy` predates explicit routing and historically treated
	// Qwen ids as Anthropic-compatible. Preserve that opt-in custom-provider
	// behavior, but keep the returned route non-Anthropic so Qwen still gets the
	// OpenAI-compatible cache_control shape used by the new routing path.
	if (isQwenModel({ modelId: request.modelId, family })) {
		return family
			? { matcher: "model-family", family }
			: { matcher: "model-id", modelId: request.modelId };
	}

	return undefined;
}

function resolveLegacyReasoningRoute(
	request: GatewayStreamRequest,
	context: GatewayProviderContext,
): GatewayModelRoute | undefined {
	if (
		resolveLegacyPromptCacheStrategy(context.provider) !== "anthropic-automatic"
	) {
		return undefined;
	}

	const family = resolveModelFamily(context);
	return isAnthropicCompatibleModel({
		modelId: request.modelId,
		family,
	})
		? { matcher: "anthropic-compatible" }
		: undefined;
}

function resolveUnroutedAnthropicReasoningRoute(
	request: GatewayStreamRequest,
	context: GatewayProviderContext,
): GatewayModelRoute | undefined {
	if (context.provider.metadata?.routing) {
		return undefined;
	}

	const family = resolveModelFamily(context);
	return isAnthropicCompatibleModel({
		modelId: request.modelId,
		family,
	})
		? { matcher: "anthropic-compatible" }
		: undefined;
}

export function resolvePromptCacheRoute(
	request: GatewayStreamRequest,
	context: GatewayProviderContext,
): GatewayModelRoute | undefined {
	const promptCache = context.provider.metadata?.routing?.promptCache;
	if (promptCache) {
		if (promptCache.format !== "anthropic-cache-control") {
			return undefined;
		}

		return promptCache.routes.find((route) =>
			modelRouteMatches(route, {
				modelId: request.modelId,
				family: resolveModelFamily(context),
				capabilities: context.model.capabilities,
			}),
		);
	}

	return resolveLegacyPromptCacheRoute(request, context);
}

export function resolveReasoningRoute(
	request: GatewayStreamRequest,
	context: GatewayProviderContext,
): GatewayModelRoute | undefined {
	const reasoning = context.provider.metadata?.routing?.reasoning;
	if (!reasoning) {
		return (
			resolveLegacyReasoningRoute(request, context) ??
			resolveUnroutedAnthropicReasoningRoute(request, context)
		);
	}
	if (reasoning.format !== "anthropic-thinking") {
		return undefined;
	}

	return reasoning.routes.find((route) =>
		modelRouteMatches(route, {
			modelId: request.modelId,
			family: resolveModelFamily(context),
			capabilities: context.model.capabilities,
		}),
	);
}

export function shouldEmitAnthropicReasoning(
	context: GatewayProviderContext,
): boolean {
	const capabilities = context.model.capabilities;
	return !capabilities || capabilities.includes("reasoning");
}

function resolveClaudeLine(
	modelId: string | undefined,
	family: string | undefined,
) {
	const normalizedFamily = family?.toLowerCase() ?? "";
	const normalizedModelId = modelId?.toLowerCase() ?? "";

	if (normalizedFamily.includes("opus") || normalizedModelId.includes("opus")) {
		return "opus" as const;
	}
	if (
		normalizedFamily.includes("sonnet") ||
		normalizedModelId.includes("sonnet")
	) {
		return "sonnet" as const;
	}
	if (
		normalizedFamily.includes("haiku") ||
		normalizedModelId.includes("haiku")
	) {
		return "haiku" as const;
	}

	return undefined;
}

function resolveClaudeVersion(modelId: string | undefined) {
	const normalized = modelId?.toLowerCase() ?? "";
	const versionFirstMatch =
		/claude-(\d+)[.-](\d{1,2})-(?:opus|sonnet|haiku)/i.exec(normalized);
	const lineFirstMatch = /claude-(?:opus|sonnet|haiku)-(.+)/i.exec(normalized);
	const tokens = lineFirstMatch?.[1]?.match(/\d+/g) ?? [];
	const majorToken = versionFirstMatch?.[1] ?? tokens[0];
	const minorToken =
		versionFirstMatch?.[2] ?? (tokens[1]?.length <= 2 ? tokens[1] : undefined);
	if (!majorToken || !minorToken) {
		return undefined;
	}

	const major = Number.parseInt(majorToken, 10);
	const minor = Number.parseInt(minorToken, 10);
	if (!Number.isFinite(major) || !Number.isFinite(minor)) {
		return undefined;
	}
	return { major, minor };
}

function supportsAnthropicAdaptiveThinkingPolicy(options: {
	modelId?: string;
	family?: string;
}): boolean {
	const line = resolveClaudeLine(options.modelId, options.family);
	const version = resolveClaudeVersion(options.modelId);
	if (!line || !version) {
		return false;
	}

	// See https://platform.claude.com/docs/en/build-with-claude/extended-thinking
	if (version.major !== 4) {
		return version.major > 4;
	}

	return (line === "opus" || line === "sonnet") && version.minor >= 6;
}

export function resolveAnthropicReasoningRequestPolicy(
	request: GatewayStreamRequest,
	context: GatewayProviderContext,
): AnthropicReasoningRequestPolicy {
	const family = resolveModelFamily(context);
	if (
		!resolveReasoningRoute(request, context) ||
		!shouldEmitAnthropicReasoning(context)
	) {
		return { kind: "none" };
	}

	return supportsAnthropicAdaptiveThinkingPolicy({
		modelId: request.modelId,
		family,
	})
		? { kind: "anthropic-adaptive" }
		: { kind: "anthropic-manual" };
}

export function buildAnthropicProviderOptions(
	request: GatewayStreamRequest,
	context: GatewayProviderContext,
) {
	const policy = resolveAnthropicReasoningRequestPolicy(request, context);
	const wantsAnthropicThinking =
		request.reasoning?.enabled === true ||
		request.reasoning?.effort !== undefined ||
		(typeof request.reasoning?.budgetTokens === "number" &&
			request.reasoning.budgetTokens > 0) ||
		(request.reasoning?.enabled === undefined &&
			modelReasoningDefaultsOn({ request, context }));

	const thinking: Record<string, unknown> | undefined = wantsAnthropicThinking
		? policy.kind === "anthropic-adaptive"
			? { type: "adaptive" }
			: policy.kind === "anthropic-manual"
				? {
						type: "enabled",
						budgetTokens: resolveAnthropicCompatibleReasoningBudget({
							modelId: request.modelId,
							family: resolveModelFamily(context),
							effort: request.reasoning?.effort,
							maxTokens: request.maxTokens,
							explicitBudgetTokens: request.reasoning?.budgetTokens,
							supportsManualThinking: policy.kind === "anthropic-manual",
						}),
					}
				: undefined
		: undefined;

	return {
		...(policy.kind === "anthropic-adaptive" && request.reasoning?.effort
			? { effort: request.reasoning.effort }
			: {}),
		...(thinking ? { thinking } : {}),
		...(shouldApplyAnthropicCacheBucket(request, context)
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
	supportsManualThinking?: boolean;
}) {
	if (
		typeof options.explicitBudgetTokens === "number" &&
		options.explicitBudgetTokens > 0
	) {
		return options.explicitBudgetTokens;
	}

	if (
		(!options.modelId && !options.family) ||
		(!options.supportsManualThinking &&
			!isAnthropicCompatibleModel({
				modelId: options.modelId,
				family: options.family,
			}))
	) {
		return undefined;
	}
	if (!options.effort) {
		return ANTHROPIC_DEFAULT_THINKING_BUDGET_TOKENS;
	}
	if (typeof options.maxTokens !== "number") {
		return ANTHROPIC_DEFAULT_THINKING_BUDGET_TOKENS;
	}
	if (options.maxTokens <= ANTHROPIC_DEFAULT_THINKING_BUDGET_TOKENS) {
		return ANTHROPIC_DEFAULT_THINKING_BUDGET_TOKENS;
	}

	const ratio = ANTHROPIC_REASONING_EFFORT_BUDGET_RATIOS[options.effort];
	if (!ratio) {
		return ANTHROPIC_DEFAULT_THINKING_BUDGET_TOKENS;
	}

	const maxBudget = Math.min(
		options.maxTokens - 1,
		ANTHROPIC_MAX_THINKING_BUDGET_TOKENS,
	);
	return Math.max(
		ANTHROPIC_DEFAULT_THINKING_BUDGET_TOKENS,
		Math.floor(maxBudget * ratio),
	);
}

export function buildAnthropicCompatibleReasoningOptions(
	request: GatewayStreamRequest,
	context: GatewayProviderContext,
) {
	const policy = resolveAnthropicReasoningRequestPolicy(request, context);
	if (
		policy.kind === "none" ||
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
		supportsManualThinking: policy.kind === "anthropic-manual",
	});
	const reasoning: Record<string, unknown> = {};

	if (request.reasoning?.enabled === true) {
		reasoning.enabled = true;
	}
	if (policy.kind === "anthropic-adaptive" && request.reasoning?.effort) {
		reasoning.effort = request.reasoning.effort;
	}
	if (typeof request.reasoning?.budgetTokens === "number") {
		reasoning.max_tokens = request.reasoning.budgetTokens;
	} else if (
		policy.kind === "anthropic-manual" &&
		typeof budgetTokens === "number" &&
		budgetTokens >= 0
	) {
		reasoning.max_tokens = budgetTokens;
	}

	return Object.keys(reasoning).length > 0 ? reasoning : undefined;
}

export function buildGatewayReasoningOptions(
	request: GatewayStreamRequest,
	context: GatewayProviderContext,
) {
	if (
		request.reasoning?.enabled === undefined &&
		!request.reasoning?.effort &&
		typeof request.reasoning?.budgetTokens !== "number"
	) {
		return undefined;
	}

	const policy = resolveAnthropicReasoningRequestPolicy(request, context);
	const reasoningRoute = resolveReasoningRoute(request, context);
	const family = resolveModelFamily(context);
	const shouldSuppressUnsupportedRoutedReasoning =
		policy.kind === "none" && reasoningRoute !== undefined;
	const shouldSuppressUnroutedAnthropicLikeReasoning =
		policy.kind === "none" &&
		reasoningRoute === undefined &&
		(shouldApplyPromptCache(request, context) ||
			isQwenModel({
				modelId: request.modelId,
				family,
			}) ||
			isAnthropicCompatibleModel({
				modelId: request.modelId,
				family,
			}));
	if (
		shouldSuppressUnsupportedRoutedReasoning ||
		shouldSuppressUnroutedAnthropicLikeReasoning
	) {
		return undefined;
	}

	const budgetTokens =
		policy.kind === "anthropic-manual"
			? resolveAnthropicCompatibleReasoningBudget({
					modelId: request.modelId,
					family,
					effort: request.reasoning?.effort,
					maxTokens: request.maxTokens,
					explicitBudgetTokens: request.reasoning?.budgetTokens,
					supportsManualThinking: policy.kind === "anthropic-manual",
				})
			: request.reasoning?.budgetTokens;
	const shouldSendDisabledReasoning =
		request.reasoning?.enabled === false &&
		// FIXME: temporary compatibility patch for models that reject disabled
		// reasoning. Remove once routed providers normalize disabled reasoning
		// consistently, or replace with a systematic model policy.
		!modelRejectsDisabledReasoning(request.modelId);
	const reasoning: Record<string, unknown> = {
		...(request.reasoning?.enabled === true
			? { enabled: true }
			: shouldSendDisabledReasoning
				? { enabled: false }
				: request.reasoning?.effort
					? { enabled: true }
					: {}),
		...(request.reasoning?.effort && policy.kind !== "anthropic-manual"
			? { effort: request.reasoning.effort }
			: {}),
	};

	if (typeof budgetTokens === "number" && budgetTokens >= 0) {
		reasoning.max_tokens = budgetTokens;
	}

	return Object.keys(reasoning).length > 0 ? reasoning : undefined;
}

function modelRejectsDisabledReasoning(modelId: string): boolean {
	const normalized = modelId.toLowerCase();
	return (
		normalized.includes("claude-fable") ||
		normalized.includes("stepfun/step-3.7-flash")
	);
}
