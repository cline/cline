import type {
	GatewayPromptCacheStrategy,
	GatewayProviderContext,
	GatewayProviderManifest,
	GatewayStreamRequest,
} from "@cline/shared";
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
		return hasAnthropicLineage(family);
	}

	return isAnthropicCompatibleModelId(options.modelId);
}

export function isAnthropicCompatibleModelId(
	modelId: string | undefined,
): boolean {
	if (!modelId) {
		return false;
	}

	return hasAnthropicLineage(modelId);
}

export function isAnthropicPromptCacheCompatibleModel(options: {
	modelId?: string;
	family?: string;
}): boolean {
	const family =
		typeof options.family === "string" ? options.family.trim() : "";
	if (family) {
		return hasAnthropicLineage(family) || hasQwenLineage(family);
	}

	return isAnthropicPromptCacheCompatibleModelId(options.modelId);
}

export function isAnthropicPromptCacheCompatibleModelId(
	modelId: string | undefined,
): boolean {
	if (!modelId) {
		return false;
	}

	return hasAnthropicLineage(modelId) || hasQwenLineage(modelId);
}

function hasAnthropicLineage(value: string): boolean {
	const normalized = value.toLowerCase();
	return normalized.includes("anthropic") || normalized.includes("claude");
}

function hasQwenLineage(value: string): boolean {
	return value.toLowerCase().includes("qwen");
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
		isAnthropicPromptCacheCompatibleModel({
			modelId: request.modelId,
			family: resolveModelFamily(context),
		}) && resolvePromptCacheStrategy(context.provider) === "anthropic-automatic"
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
		!isAnthropicCompatibleModel({ modelId: request.modelId, family }) ||
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
	const policy = resolveAnthropicReasoningRequestPolicy(request, context);
	const wantsAnthropicThinking =
		request.reasoning?.enabled === true ||
		request.reasoning?.effort !== undefined ||
		(typeof request.reasoning?.budgetTokens === "number" &&
			request.reasoning.budgetTokens > 0);

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
						}),
					}
				: undefined
		: undefined;

	return {
		...(policy.kind === "anthropic-adaptive" && request.reasoning?.effort
			? { effort: request.reasoning.effort }
			: {}),
		...(thinking ? { thinking } : {}),
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
		})
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
	if (
		policy.kind === "none" &&
		isAnthropicCompatibleModel({
			modelId: request.modelId,
			family: resolveModelFamily(context),
		})
	) {
		return undefined;
	}

	const budgetTokens =
		policy.kind === "anthropic-manual"
			? resolveAnthropicCompatibleReasoningBudget({
					modelId: request.modelId,
					family: resolveModelFamily(context),
					effort: request.reasoning?.effort,
					maxTokens: request.maxTokens,
					explicitBudgetTokens: request.reasoning?.budgetTokens,
				})
			: request.reasoning?.budgetTokens;
	const reasoning: Record<string, unknown> = {
		...(request.reasoning?.enabled === true
			? { enabled: true }
			: request.reasoning?.enabled === false
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
