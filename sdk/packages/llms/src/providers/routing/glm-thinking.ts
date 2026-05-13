import type {
	GatewayProviderContext,
	GatewayProviderMetadata,
	GatewayStreamRequest,
} from "@cline/shared";
import { isGlmModel } from "../model-facts";
import type { ProviderOptionsPatch } from "./utils";

/**
 * GLM thinking routing.
 *
 * Native Z.AI uses `thinking: { type: "enabled" | "disabled" }`.
 * Routed OpenAI-compatible GLM endpoints should use the generic `reasoning`
 * control shape. The return value is a normal provider-options patch so the
 * composer can rely on merge order instead of out-of-band flags.
 */

export const GLM_THINKING_ROUTING_METADATA: GatewayProviderMetadata = {
	routing: {
		reasoning: {
			format: "glm-thinking",
			routes: [
				{ matcher: "model-family", family: "glm" },
				{ matcher: "model-family", family: "glm-air" },
				{ matcher: "model-family", family: "glm-flash" },
			],
		},
	},
};

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

export function buildNativeGlmThinkingProviderOptionsPatch(
	request: GatewayStreamRequest,
	providerOptionsKey: string,
): ProviderOptionsPatch | undefined {
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

export function buildRoutedGlmReasoningProviderOptionsPatch(
	request: GatewayStreamRequest,
	context: GatewayProviderContext,
	providerOptionsKey: string,
	options?: { includeProviderBuckets?: boolean },
): ProviderOptionsPatch | undefined {
	if (!isGlmModel(request, context)) {
		return undefined;
	}

	const routed = buildRoutedGlmReasoningOptions(request);
	if (!routed) {
		return undefined;
	}

	return {
		openaiCompatible: routed,
		...(options?.includeProviderBuckets === false
			? {}
			: {
					[request.providerId]: routed,
					...(providerOptionsKey !== request.providerId
						? { [providerOptionsKey]: routed }
						: {}),
				}),
	};
}
