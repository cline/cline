import type {
	GatewayProviderContext,
	GatewayStreamRequest,
} from "@cline/shared";
import {
	buildAnthropicCompatibleReasoningOptions,
	isAnthropicCompatibleModel,
	resolveAnthropicReasoningRequestPolicy,
	resolveModelFamily,
	shouldUseAnthropicPromptCache,
} from "./anthropic-compatible";
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

	const isAnthropicCompatible = isAnthropicCompatibleModel({
		modelId: request.modelId,
		family: resolveModelFamily(context),
	});
	const anthropicPolicy = isAnthropicCompatible
		? resolveAnthropicReasoningRequestPolicy(request, context)
		: undefined;
	if (anthropicPolicy && anthropicPolicy.kind !== "anthropic-adaptive") {
		return {};
	}
	return { thinking: { type: "adaptive" } };
}

function buildCompatibleEffortOptions(options: {
	reasoning: GatewayStreamRequest["reasoning"];
	isAnthropicCompatibleModelId: boolean;
	suppressions: ProviderOptionSuppression;
	anthropicReasoningPolicyKind?: ReturnType<
		typeof resolveAnthropicReasoningRequestPolicy
	>["kind"];
}): Record<string, unknown> {
	const effort = options.reasoning?.effort;
	if (
		options.suppressions.genericEffort ||
		!effort ||
		options.reasoning?.enabled === false
	) {
		return {};
	}
	const allowEffort =
		!options.isAnthropicCompatibleModelId ||
		options.anthropicReasoningPolicyKind === "anthropic-adaptive";
	if (!allowEffort) {
		return {};
	}
	return {
		effort,
		reasoningEffort: effort,
		...(options.isAnthropicCompatibleModelId
			? {}
			: { reasoningSummary: "auto" }),
	};
}

export function buildCompatibleProviderOptions(options: {
	request: GatewayStreamRequest;
	context: GatewayProviderContext;
	isAnthropicCompatibleModelId: boolean;
	target: AiSdkProviderOptionsTarget;
	suppressions: ProviderOptionSuppression;
}): Record<string, unknown> {
	const {
		request,
		context,
		isAnthropicCompatibleModelId,
		target,
		suppressions,
	} = options;
	const anthropicReasoningPolicy = isAnthropicCompatibleModelId
		? resolveAnthropicReasoningRequestPolicy(request, context)
		: undefined;
	const reasoning = buildAnthropicCompatibleReasoningOptions(request, context);
	const promptCache = shouldUseAnthropicPromptCache(request, context)
		? createEphemeralCacheControl()
		: {};

	return {
		...(target === "openai-compatible" ? { strictJsonSchema: false } : {}),
		...buildCompatibleThinkingOptions({ request, context, suppressions }),
		...buildCompatibleEffortOptions({
			reasoning: request.reasoning,
			isAnthropicCompatibleModelId,
			suppressions,
			anthropicReasoningPolicyKind: anthropicReasoningPolicy?.kind,
		}),
		...(reasoning ? { reasoning } : {}),
		...promptCache,
		...buildOpenAINativeProviderOptions(request),
	};
}
