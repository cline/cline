import type {
	GatewayProviderContext,
	GatewayStreamRequest,
} from "@clinebot/shared";
import {
	buildAnthropicCompatibleReasoningOptions,
	buildAnthropicProviderOptions,
	buildGatewayReasoningOptions,
	isAnthropicCompatibleModel,
	resolveModelFamily,
	shouldUseAnthropicPromptCache,
} from "./anthropic-compatible";
import {
	buildGlmThinkingProviderOptionsPatch,
	shouldSuppressGenericCompatibleThinking,
} from "./glm-thinking";
import {
	createEphemeralCacheControl,
	type ProviderOptionsPatch,
	toProviderOptionsKey,
} from "./utils";

export type { ProviderOptionsPatch } from "./utils";

/** Merge patches in order. Later patches override earlier ones per bucket key. */
export function mergeProviderOptionPatches(
	patches: ReadonlyArray<ProviderOptionsPatch | undefined>,
): Record<string, unknown> {
	const result: Record<string, Record<string, unknown>> = {};
	for (const patch of patches) {
		if (!patch) {
			continue;
		}
		for (const [bucket, options] of Object.entries(patch)) {
			result[bucket] = { ...(result[bucket] ?? {}), ...options };
		}
	}
	return result;
}

function buildProviderAndAliasPatch(options: {
	providerId: string;
	providerOptionsKey: string;
	bucketOptions: Record<string, unknown>;
}): ProviderOptionsPatch {
	return {
		[options.providerId]: options.bucketOptions,
		...(options.providerOptionsKey !== options.providerId &&
		options.providerOptionsKey !== "anthropic"
			? { [options.providerOptionsKey]: options.bucketOptions }
			: {}),
	};
}

function buildCompatibleThinkingOptions(
	request: GatewayStreamRequest,
	context: GatewayProviderContext,
): Record<string, unknown> {
	return {
		...(!shouldSuppressGenericCompatibleThinking(request, context) &&
		request.reasoning?.enabled === true
			? { thinking: { type: "adaptive" } }
			: {}),
	};
}

function buildCompatibleEffortOptions(options: {
	reasoning: GatewayStreamRequest["reasoning"];
	isAnthropicCompatibleModelId: boolean;
}): Record<string, unknown> {
	return {
		...(options.reasoning?.effort ? { effort: options.reasoning.effort } : {}),
		...(options.reasoning?.effort
			? { reasoningEffort: options.reasoning.effort }
			: {}),
		...(options.reasoning?.effort && !options.isAnthropicCompatibleModelId
			? { reasoningSummary: "auto" }
			: {}),
	};
}

function buildAnthropicCompatibleProviderOptions(
	request: GatewayStreamRequest,
	context: GatewayProviderContext,
): Record<string, unknown> {
	const reasoning = buildAnthropicCompatibleReasoningOptions(request, context);
	return reasoning ? { reasoning } : {};
}

function buildPromptCacheProviderOptions(
	request: GatewayStreamRequest,
	context: GatewayProviderContext,
): Record<string, unknown> {
	return shouldUseAnthropicPromptCache(request, context)
		? createEphemeralCacheControl()
		: {};
}

function buildOpenAINativeProviderOptions(
	request: GatewayStreamRequest,
): Record<string, unknown> {
	return request.providerId === "openai-native" ? { truncation: "auto" } : {};
}

function buildCompatibleProviderOptions(options: {
	request: GatewayStreamRequest;
	context: GatewayProviderContext;
	isAnthropicCompatibleModelId: boolean;
}): Record<string, unknown> {
	const { request, context, isAnthropicCompatibleModelId } = options;

	return {
		...buildCompatibleThinkingOptions(request, context),
		...buildCompatibleEffortOptions({
			reasoning: request.reasoning,
			isAnthropicCompatibleModelId,
		}),
		...buildAnthropicCompatibleProviderOptions(request, context),
		...buildPromptCacheProviderOptions(request, context),
		...buildOpenAINativeProviderOptions(request),
	};
}

function buildBaseProviderOptionsPatch(
	compatibleOptions: Record<string, unknown>,
	anthropicOptions: Record<string, unknown>,
): ProviderOptionsPatch {
	return {
		anthropic: anthropicOptions,
		openaiCompatible: compatibleOptions,
	};
}

function buildOpenAICodexProviderOptionsPatch(
	request: GatewayStreamRequest,
	providerOptionsKey: string,
	compatibleOptions: Record<string, unknown>,
): ProviderOptionsPatch | undefined {
	if (request.providerId !== "openai-codex") {
		return undefined;
	}

	const codexOptions = {
		...compatibleOptions,
		instructions: request.systemPrompt,
		store: false,
		systemMessageMode: "remove" as const,
	};

	return {
		openai: codexOptions,
		...buildProviderAndAliasPatch({
			providerId: request.providerId,
			providerOptionsKey,
			bucketOptions: codexOptions,
		}),
	};
}

function buildProviderFanoutPatch(
	request: GatewayStreamRequest,
	context: GatewayProviderContext,
	providerOptionsKey: string,
	compatibleOptions: Record<string, unknown>,
): ProviderOptionsPatch | undefined {
	if (
		request.providerId === "anthropic" ||
		request.providerId === "openai-codex" ||
		request.providerId === "google"
	) {
		return undefined;
	}

	const gatewayReasoning = buildGatewayReasoningOptions(request, context);
	const providerOptions = {
		...compatibleOptions,
		...(request.providerId === "cline" && gatewayReasoning
			? { reasoning: gatewayReasoning }
			: {}),
	};

	return buildProviderAndAliasPatch({
		providerId: request.providerId,
		providerOptionsKey,
		bucketOptions: providerOptions,
	});
}

function buildGeminiProviderOptionsPatch(
	request: GatewayStreamRequest,
): ProviderOptionsPatch | undefined {
	if (request.providerId !== "google" && request.providerId !== "gemini") {
		return undefined;
	}
	if (!request.reasoning?.effort) {
		return undefined;
	}

	return {
		google: {
			thinkingConfig: {
				thinkingLevel: request.reasoning.effort,
				includeThoughts: true,
			},
		},
	};
}

/**
 * Compose AI SDK `providerOptions` from a small set of ordered patches.
 *
 * Precedence (low -> high):
 *  1. base/openai-compatible buckets
 *  2. codex provider-specific override
 *  3. provider-id + alias fanout
 *  4. gemini-specific google bucket
 *  5. GLM/Z.AI overlay
 */
export function composeAiSdkProviderOptions(
	request: GatewayStreamRequest,
	context: GatewayProviderContext,
): Record<string, unknown> {
	const providerOptionsKey = toProviderOptionsKey(request.providerId);
	const isAnthropicCompatibleModelId = isAnthropicCompatibleModel({
		modelId: request.modelId,
		family: resolveModelFamily(context),
	});
	const compatibleOptions = buildCompatibleProviderOptions({
		request,
		context,
		isAnthropicCompatibleModelId,
	});
	const anthropicOptions = buildAnthropicProviderOptions(request, context);

	return mergeProviderOptionPatches([
		buildBaseProviderOptionsPatch(compatibleOptions, anthropicOptions),
		buildOpenAICodexProviderOptionsPatch(
			request,
			providerOptionsKey,
			compatibleOptions,
		),
		buildProviderFanoutPatch(
			request,
			context,
			providerOptionsKey,
			compatibleOptions,
		),
		buildGeminiProviderOptionsPatch(request),
		buildGlmThinkingProviderOptionsPatch(request, context, providerOptionsKey),
	]);
}
