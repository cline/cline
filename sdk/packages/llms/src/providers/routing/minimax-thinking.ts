import type {
	GatewayProviderMetadata,
	GatewayStreamRequest,
} from "@cline/shared";
import { MINIMAX_FLASH_MODEL_ID } from "../../catalog/catalog-minimax";
import { buildProviderAndAliasPatch, type ProviderOptionsPatch } from "./utils";

export const MINIMAX_THINKING_ROUTING_METADATA: GatewayProviderMetadata = {
	routing: {
		reasoning: {
			format: "minimax-thinking",
			routes: [
				{
					matcher: "model-id",
					modelId: MINIMAX_FLASH_MODEL_ID,
					requiredCapability: "reasoning",
				},
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
	if (request.modelId === MINIMAX_FLASH_MODEL_ID) {
		return {
			thinking: { type: "adaptive" },
			effort: request.reasoning?.effort ?? "max",
		};
	}
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
		...buildProviderAndAliasPatch({
			providerId: request.providerId,
			providerOptionsKey: providerOptionsKey,
			bucketOptions: thinking,
		}),
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
