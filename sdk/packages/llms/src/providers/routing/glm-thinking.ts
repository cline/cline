import type {
	GatewayProviderContext,
	GatewayStreamRequest,
} from "@clinebot/shared";
import { resolveModelFamily } from "./anthropic-compatible";

/**
 * GLM thinking routing.
 *
 * Native Z.AI uses `thinking: { type: "enabled" | "disabled" }`.
 * Routed OpenAI-compatible GLM endpoints should use the generic `reasoning`
 * control shape. Keep the native Z.AI dialect out of the generic
 * OpenAI-compatible request builder.
 */

interface GlmThinkingProviderOptions {
	/** Options safe to include in generic OpenAI-compatible provider options. */
	compatible?: Record<string, unknown>;
	/** Options for the concrete provider id, e.g. `zai`, `cline`, or `openrouter`. */
	provider?: Record<string, unknown>;
	/** Options for the AI SDK provider-options alias, e.g. `openRouter` or `vercelAiGateway`. */
	providerOptionsKey?: Record<string, unknown>;
	/** True when `compatible` already chose the thinking option shape. */
	handlesCompatibleThinking?: boolean;
}

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

export function buildGlmThinkingProviderOptions(
	request: GatewayStreamRequest,
	context: GatewayProviderContext,
	providerOptionsKey: string,
): GlmThinkingProviderOptions | undefined {
	if (isNativeZaiProvider(request.providerId)) {
		if (!isGlmModel(request, context)) {
			return request.reasoning?.enabled === undefined
				? undefined
				: { handlesCompatibleThinking: true };
		}
		const compatible = buildNativeZaiThinkingOptions(request);
		return compatible
			? {
					compatible,
					handlesCompatibleThinking: true,
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
		compatible: routed,
		provider: routed,
		providerOptionsKey:
			providerOptionsKey === request.providerId ? undefined : routed,
		handlesCompatibleThinking: true,
	};
}
