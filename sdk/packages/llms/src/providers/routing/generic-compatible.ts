import type {
	GatewayProviderContext,
	GatewayStreamRequest,
} from "@cline/shared";
import {
	getModelReasoningControls,
	isAnthropicCompatibleModel,
	isQwenModel,
	resolveModelFamily,
} from "../model-facts";
import {
	buildAnthropicCompatibleReasoningOptions,
	resolveAnthropicReasoningRequestPolicy,
	resolveReasoningRoute,
	shouldApplyPromptCache,
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
	if (!isNativeOpenAIClient) {
		return {};
	}

	const reasoningEffort =
		request.reasoning?.enabled === false ? "none" : request.reasoning?.effort;
	return {
		truncation: "auto",
		...(reasoningEffort ? { reasoningEffort } : {}),
	};
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

	const anthropicPolicy = resolveAnthropicReasoningRequestPolicy(
		request,
		context,
	);
	const hasAnthropicReasoningRoute =
		resolveReasoningRoute(request, context) !== undefined;
	if (
		!hasAnthropicReasoningRoute ||
		anthropicPolicy.kind !== "anthropic-adaptive"
	) {
		return {};
	}
	return { thinking: { type: "adaptive" } };
}

function buildCompatibleEffortOptions(options: {
	reasoning: GatewayStreamRequest["reasoning"];
	reasoningOptions?: GatewayProviderContext["model"]["reasoningOptions"];
	usesAnthropicReasoningRoute: boolean;
	suppressEffortOptions: boolean;
	suppressions: ProviderOptionSuppression;
	anthropicReasoningPolicyKind?: ReturnType<
		typeof resolveAnthropicReasoningRequestPolicy
	>["kind"];
}): Record<string, unknown> {
	const controls = getModelReasoningControls(options.reasoningOptions);
	const rawEffort =
		options.reasoning?.enabled === false &&
		controls?.effort?.values.includes("none")
			? "none"
			: (options.reasoning?.effort ??
				(options.reasoning?.enabled === true &&
				!options.usesAnthropicReasoningRoute &&
				controls?.supportsDefault
					? "default"
					: undefined));
	if (
		options.suppressions.genericEffort ||
		!rawEffort ||
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
		reasoningEffort: rawEffort,
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
	const hasAdvertisedReasoningControls =
		context.model.reasoningOptions !== undefined;
	const suppressCompatibleReasoningOptions =
		!usesAnthropicReasoningRoute &&
		!hasAdvertisedReasoningControls &&
		(hasPromptCacheRoute || isQwen || isAnthropicCompatible);
	const reasoning = buildAnthropicCompatibleReasoningOptions(request, context);
	const promptCache = hasPromptCacheRoute ? createEphemeralCacheControl() : {};

	return {
		...(target === "openai-compatible" ? { strictJsonSchema: false } : {}),
		...buildCompatibleThinkingOptions({ request, context, suppressions }),
		...buildCompatibleEffortOptions({
			reasoning: request.reasoning,
			reasoningOptions: context.model.reasoningOptions,
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
