import type {
	GatewayProviderContext,
	GatewayStreamRequest,
} from "@cline/shared";
import {
	buildAnthropicCompatibleReasoningOptions,
	resolveAnthropicReasoningRequestPolicy,
	resolveReasoningRoute,
	shouldApplyPromptCache,
} from "./anthropic-compatible";
import {
	isAnthropicCompatibleModel,
	isQwenModel,
	resolveModelFamily,
} from "../model-facts";
import type {
	AiSdkProviderOptionsTarget,
	ProviderOptionSuppression,
} from "./provider-options-types";
import { createEphemeralCacheControl } from "./utils";

export function buildOpenAINativeProviderOptions(
	request: GatewayStreamRequest,
): Record<string, unknown> {
	const isNativeOpenAIClient = ["openai-native", "openai"].includes(
		request.providerId,
	);
	return isNativeOpenAIClient ? { truncation: "auto" } : {};
}

function buildCompatibleThinkingOptions(options: {
	request: GatewayStreamRequest;
	context: GatewayProviderContext;
	suppressions: ProviderOptionSuppression;
}): Record<string, unknown> {
	const { request, context, suppressions } = options;
	if (suppressions.genericThinking) {
		return {};
	}
	if (request.reasoning?.enabled !== true) {
		return {};
	}

	const family = resolveModelFamily(context);
	const anthropicPolicy = resolveAnthropicReasoningRequestPolicy(
		request,
		context,
	);
	const hasAnthropicReasoningRoute =
		resolveReasoningRoute(request, context) !== undefined;
	const hasPromptCacheRoute = shouldApplyPromptCache(request, context);
	const isAnthropicCompatible = isAnthropicCompatibleModel({
		modelId: request.modelId,
		family,
	});
	const isQwen = isQwenModel({
		modelId: request.modelId,
		family,
	});
	if (
		!hasAnthropicReasoningRoute &&
		(hasPromptCacheRoute || isQwen || isAnthropicCompatible)
	) {
		return {};
	}
	if (
		hasAnthropicReasoningRoute &&
		anthropicPolicy.kind !== "anthropic-adaptive"
	) {
		return {};
	}
	return { thinking: { type: "adaptive" } };
}

function buildCompatibleEffortOptions(options: {
	reasoning: GatewayStreamRequest["reasoning"];
	usesAnthropicReasoningRoute: boolean;
	suppressEffortOptions: boolean;
	suppressions: ProviderOptionSuppression;
	anthropicReasoningPolicyKind?: ReturnType<
		typeof resolveAnthropicReasoningRequestPolicy
	>["kind"];
}): Record<string, unknown> {
	const effort = options.reasoning?.effort;
	if (
		options.suppressions.genericEffort ||
		!effort ||
		options.reasoning?.enabled === false ||
		options.suppressEffortOptions
	) {
		return {};
	}
	const allowEffort =
		!options.usesAnthropicReasoningRoute ||
		options.anthropicReasoningPolicyKind === "anthropic-adaptive";
	if (!allowEffort) {
		return {};
	}
	return {
		effort,
		reasoningEffort: effort,
		...(options.usesAnthropicReasoningRoute
			? {}
			: { reasoningSummary: "auto" }),
	};
}

export function buildCompatibleProviderOptions(options: {
	request: GatewayStreamRequest;
	context: GatewayProviderContext;
	target: AiSdkProviderOptionsTarget;
	suppressions: ProviderOptionSuppression;
}): Record<string, unknown> {
	const { request, context, target, suppressions } = options;
	const family = resolveModelFamily(context);
	const anthropicReasoningPolicy = resolveAnthropicReasoningRequestPolicy(
		request,
		context,
	);
	const usesAnthropicReasoningRoute =
		resolveReasoningRoute(request, context) !== undefined;
	const hasPromptCacheRoute = shouldApplyPromptCache(request, context);
	const isAnthropicCompatible = isAnthropicCompatibleModel({
		modelId: request.modelId,
		family,
	});
	const isQwen = isQwenModel({
		modelId: request.modelId,
		family,
	});
	const suppressCompatibleReasoningOptions =
		!usesAnthropicReasoningRoute &&
		(hasPromptCacheRoute || isQwen || isAnthropicCompatible);
	const reasoning = buildAnthropicCompatibleReasoningOptions(request, context);
	const promptCache = hasPromptCacheRoute ? createEphemeralCacheControl() : {};

	return {
		...(target === "openai-compatible" ? { strictJsonSchema: false } : {}),
		...buildCompatibleThinkingOptions({ request, context, suppressions }),
		...buildCompatibleEffortOptions({
			reasoning: request.reasoning,
			usesAnthropicReasoningRoute,
			suppressEffortOptions: suppressCompatibleReasoningOptions,
			suppressions,
			anthropicReasoningPolicyKind: anthropicReasoningPolicy.kind,
		}),
		...(reasoning ? { reasoning } : {}),
		...promptCache,
		...buildOpenAINativeProviderOptions(request),
	};
}
