import type {
	GatewayProviderMetadata,
	GatewayStreamRequest,
} from "@cline/shared";
import {
	buildProviderAndAliasPatch,
	type ProviderOptionsPatch,
} from "./utils";

export const MINIMAX_THINKING_ROUTING_METADATA: GatewayProviderMetadata = {
	routing: {
		promptCache: {
			format: "anthropic-cache-control",
			routes: [{ matcher: "anthropic-compatible" }],
		},
		reasoning: {
			format: "minimax-thinking",
			routes: [
				{
					matcher: "model-id",
					modelId: "MiniMax-M3",
					requiredCapability: "reasoning",
				},
			],
		},
	},
};

function buildMiniMaxThinkingOptions(request: GatewayStreamRequest) {
	if (request.reasoning?.enabled === true) {
		return { thinking: { type: "adaptive" } };
	}
	if (request.reasoning?.enabled === false) {
		return { thinking: { type: "disabled" } };
	}
	return undefined;
}

function buildMiniMaxGatewayReasoningOptions(request: GatewayStreamRequest) {
	if (request.reasoning?.enabled === true) {
		return { reasoning: { enabled: true } };
	}
	if (request.reasoning?.enabled === false) {
		return { reasoning: { exclude: true } };
	}
	return undefined;
}

export function buildMiniMaxThinkingProviderOptionsPatch(
	request: GatewayStreamRequest,
	providerOptionsKey: string,
): ProviderOptionsPatch | undefined {
	const thinking = buildMiniMaxThinkingOptions(request);
	if (!thinking) {
		return undefined;
	}
	return {
		openaiCompatible: thinking,
		[request.providerId]: thinking,
		...(providerOptionsKey !== request.providerId
			? { [providerOptionsKey]: thinking }
			: {}),
	};
}

export function buildMiniMaxGatewayReasoningProviderOptionsPatch(
	request: GatewayStreamRequest,
	providerOptionsKey: string,
): ProviderOptionsPatch | undefined {
	const reasoning = buildMiniMaxGatewayReasoningOptions(request);
	return reasoning
		? buildProviderAndAliasPatch({
				providerId: request.providerId,
				providerOptionsKey,
				bucketOptions: reasoning,
			})
		: undefined;
}
