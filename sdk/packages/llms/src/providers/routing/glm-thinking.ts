import type {
	GatewayProviderContext,
	GatewayStreamRequest,
} from "@clinebot/shared";
import { resolveModelFamily } from "./anthropic-compatible";
import type { ProviderOptionsPatch } from "./utils";

/**
 * GLM thinking routing.
 *
 * Native Z.AI uses `thinking: { type: "enabled" | "disabled" }`.
 * Routed OpenAI-compatible GLM endpoints should use the generic `reasoning`
 * control shape. The return value is a normal provider-options patch so the
 * composer can rely on merge order instead of out-of-band flags.
 */

export function isGlmModel(
	request: GatewayStreamRequest,
	context: GatewayProviderContext,
): boolean {
	const family = resolveModelFamily(context)?.toLowerCase() ?? "";
	const modelId = request.modelId.toLowerCase();
	return family.includes("glm") || modelId.includes("glm");
}

export function isNativeZaiProvider(providerId: string): boolean {
	return providerId === "zai" || providerId === "zai-coding-plan";
}

export function shouldSuppressGenericCompatibleThinking(
	request: GatewayStreamRequest,
	context: GatewayProviderContext,
): boolean {
	return (
		(isNativeZaiProvider(request.providerId) &&
			request.reasoning?.enabled !== undefined &&
			!isGlmModel(request, context)) ||
		(isGlmModel(request, context) && !isNativeZaiProvider(request.providerId))
	);
}

function buildNativeZaiThinkingOptions(request: GatewayStreamRequest) {
	if (request.reasoning?.enabled === undefined) {
		return undefined;
	}
	return {
		thinking: {
			type: request.reasoning.enabled ? "enabled" : "disabled",
		},
	};
}

function buildRoutedGlmReasoningOptions(request: GatewayStreamRequest) {
	if (request.reasoning?.enabled === true) {
		return {
			reasoning: {
				enabled: true,
			},
		};
	}
	if (request.reasoning?.enabled === false) {
		return {
			reasoning: {
				exclude: true,
			},
		};
	}
	return undefined;
}

export function buildGlmThinkingProviderOptionsPatch(
	request: GatewayStreamRequest,
	context: GatewayProviderContext,
	providerOptionsKey: string,
): ProviderOptionsPatch | undefined {
	if (isNativeZaiProvider(request.providerId)) {
		if (!isGlmModel(request, context)) {
			return undefined;
		}
		const nativeThinking = buildNativeZaiThinkingOptions(request);
		return nativeThinking
			? {
					openaiCompatible: nativeThinking,
					[request.providerId]: nativeThinking,
					...(providerOptionsKey !== request.providerId
						? { [providerOptionsKey]: nativeThinking }
						: {}),
				}
			: undefined;
	}

	if (!isGlmModel(request, context)) {
		return undefined;
	}

	const routed = buildRoutedGlmReasoningOptions(request);
	if (!routed) {
		return undefined;
	}

	return {
		openaiCompatible: routed,
		[request.providerId]: routed,
		...(providerOptionsKey !== request.providerId
			? { [providerOptionsKey]: routed }
			: {}),
	};
}
