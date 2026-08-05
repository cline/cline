import {
	type GatewayModelRoute,
	type GatewayPromptCacheStrategy,
	type GatewayProviderContext,
	type GatewayProviderManifest,
	type GatewayProviderMetadata,
	type GatewayStreamRequest,
	resolveReasoningBudgetFromRatio,
} from "@cline/shared";
import {
	getModelReasoningControls,
	isAnthropicCompatibleModel,
	isQwenModel,
	modelRouteMatches,
	resolveClaudeThinkingEra,
	resolveModelFamily,
} from "../model-facts";
import { createEphemeralCacheControl, toProviderOptionsKey } from "./utils";

const ANTHROPIC_DEFAULT_THINKING_BUDGET_TOKENS = 1024;
const ANTHROPIC_MAX_THINKING_BUDGET_TOKENS = 128000;

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

export function resolveAnthropicReasoningRequestPolicy(
	request: GatewayStreamRequest,
	context: GatewayProviderContext,
): AnthropicReasoningRequestPolicy {
	if (
		!resolveReasoningRoute(request, context) ||
		!shouldEmitAnthropicReasoning(context)
	) {
		return { kind: "none" };
	}

	const controls = getModelReasoningControls(context.model.reasoningOptions);
	if (controls) {
		// Models that advertise an effort control are adaptive-era. Their API
		// rejects the manual wire shape (thinking.type "enabled") even when a
		// budget_tokens control is also advertised, so a numeric request
		// budget must not force manual thinking; the budget is ignored in
		// favor of adaptive.
		if (controls.effort) {
			return { kind: "anthropic-adaptive" };
		}
		return controls.budget || controls.toggle
			? { kind: "anthropic-manual" }
			: { kind: "none" };
	}

	// No catalog reasoning metadata: fall back to the id-based era policy
	// (see resolveClaudeThinkingEra). 4.6+/5.x Claude ids require adaptive;
	// unknown Claude ids default to adaptive for forward compatibility,
	// matching @ai-sdk/anthropic's capability defaults — except when the
	// request carries an explicit numeric budget, which signals a custom
	// endpoint that expects the manual shape. Legacy Claude families and
	// non-Claude Anthropic-compatible ids keep manual, the safe shape for
	// third-party endpoints.
	const era = resolveClaudeThinkingEra(request.modelId);
	const hasExplicitBudget = typeof request.reasoning?.budgetTokens === "number";
	return era === "adaptive" || (era === "unknown-claude" && !hasExplicitBudget)
		? { kind: "anthropic-adaptive" }
		: { kind: "anthropic-manual" };
}

export function buildAnthropicProviderOptions(
	request: GatewayStreamRequest,
	context: GatewayProviderContext,
) {
	const explicitBudget =
		request.reasoning?.enabled === false
			? undefined
			: request.reasoning?.budgetTokens;

	// Effort-only and enable/disable intent rides the portable top-level
	// reasoning option, so only explicit-budget requests reach this wire
	// shape. Adaptive-era models reject the manual shape (thinking.type
	// "enabled") even for numeric budgets, so the request budget is ignored
	// in favor of adaptive thinking there.
	let thinking: Record<string, unknown> | undefined;
	let effort: string | undefined;
	if (typeof explicitBudget === "number") {
		const policy = resolveAnthropicReasoningRequestPolicy(request, context);
		if (policy.kind === "anthropic-adaptive") {
			thinking = { type: "adaptive" };
			effort = request.reasoning?.effort;
		} else if (policy.kind === "anthropic-manual") {
			const budgetTokens = resolveAnthropicManualBudget(request, context);
			if (budgetTokens !== undefined) {
				thinking = { type: "enabled", budgetTokens };
			}
		}
	}

	return {
		...(effort ? { effort } : {}),
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
}) {
	const minimumBudget = ANTHROPIC_DEFAULT_THINKING_BUDGET_TOKENS;
	const maximumBudget = Math.min(
		ANTHROPIC_MAX_THINKING_BUDGET_TOKENS,
		typeof options.maxTokens === "number"
			? options.maxTokens - 1
			: ANTHROPIC_MAX_THINKING_BUDGET_TOKENS,
	);
	if (maximumBudget < 1) {
		return undefined;
	}
	const defaultBudget = Math.min(minimumBudget, maximumBudget);
	if (
		typeof options.explicitBudgetTokens === "number" &&
		options.explicitBudgetTokens > 0
	) {
		return Math.min(
			Math.max(Math.floor(options.explicitBudgetTokens), defaultBudget),
			maximumBudget,
		);
	}

	if (
		(!options.modelId && !options.family) ||
		!isAnthropicCompatibleModel({
			modelId: options.modelId,
			family: options.family,
		})
	) {
		return undefined;
	}
	if (!options.effort || typeof options.maxTokens !== "number") {
		return defaultBudget;
	}

	return (
		resolveReasoningBudgetFromRatio({
			// Anthropic thinking shares max_tokens with visible output.
			effort: options.effort === "max" ? "xhigh" : options.effort,
			maxBudget: maximumBudget,
			minimumBudget: defaultBudget,
		}) ?? defaultBudget
	);
}

function resolveAnthropicManualBudget(
	request: GatewayStreamRequest,
	context: GatewayProviderContext,
): number | undefined {
	const explicitBudgetTokens = request.reasoning?.budgetTokens;
	if (
		typeof explicitBudgetTokens !== "number" &&
		context.model.reasoningOptions !== undefined
	) {
		return undefined;
	}
	return resolveAnthropicCompatibleReasoningBudget({
		modelId: request.modelId,
		family: resolveModelFamily(context),
		effort: request.reasoning?.effort,
		maxTokens: request.maxTokens,
		explicitBudgetTokens,
	});
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

	const budgetTokens = resolveAnthropicManualBudget(request, context);
	if (request.reasoning?.enabled === false) {
		return { enabled: false };
	}
	const reasoning: Record<string, unknown> = {};

	if (request.reasoning?.enabled === true) {
		reasoning.enabled = true;
	}
	if (
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
		request.reasoning?.enabled === false
			? undefined
			: policy.kind === "anthropic-manual"
				? resolveAnthropicManualBudget(request, context)
				: request.reasoning?.budgetTokens;
	const reasoning: Record<string, unknown> = {
		...(request.reasoning?.enabled === true
			? { enabled: true }
			: request.reasoning?.enabled === false
				? { enabled: false }
				: {}),
	};

	if (typeof budgetTokens === "number" && budgetTokens >= 0) {
		reasoning.max_tokens = budgetTokens;
	}

	return Object.keys(reasoning).length > 0 ? reasoning : undefined;
}
