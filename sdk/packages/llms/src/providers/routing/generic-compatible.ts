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
import type {
	AiSdkProviderOptionsTarget,
	ProviderOptionSuppression,
} from "./provider-options-types";
import { createEphemeralCacheControl } from "./utils";

export function buildOpenAINativeProviderOptions(): Record<string, unknown> {
	return { truncation: "auto" };
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

export function buildCompatibleProviderOptions(options: {
	request: GatewayStreamRequest;
	context: GatewayProviderContext;
	target: AiSdkProviderOptionsTarget;
	suppressions: ProviderOptionSuppression;
}): Record<string, unknown> {
	const { request, context, target, suppressions } = options;
	const hasPromptCacheRoute = shouldApplyPromptCache(request, context);
	const reasoning = buildAnthropicCompatibleReasoningOptions(request, context);
	const promptCache = hasPromptCacheRoute ? createEphemeralCacheControl() : {};

	return {
		...(target === "openai-compatible" ? { strictJsonSchema: false } : {}),
		...buildCompatibleThinkingOptions({ request, context, suppressions }),
		...(reasoning ? { reasoning } : {}),
		...promptCache,
		...(["openai", "openai-native"].includes(request.providerId)
			? buildOpenAINativeProviderOptions()
			: {}),
	};
}
