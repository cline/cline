import type {
	GatewayProviderContext,
	GatewayStreamRequest,
} from "@cline/shared";
import {
	isQwenModel,
	normalizeRoutingValue,
	resolveModelFamily,
} from "../model-facts";
import { buildProviderAndAliasPatch, type ProviderOptionsPatch } from "./utils";

export function usesChutesChatTemplateReasoning(
	request: Pick<GatewayStreamRequest, "providerId" | "modelId">,
	context: GatewayProviderContext,
): boolean {
	// Chutes hosts heterogeneous families. Provider routing metadata would claim
	// its single reasoning format and disable Cline's fallbacks for other families.
	if (
		request.providerId !== "chutes" ||
		!context.model.capabilities?.includes("reasoning")
	) {
		return false;
	}

	const family = resolveModelFamily(context);
	return (
		normalizeRoutingValue(family) === "kimi-k2" ||
		isQwenModel({ modelId: request.modelId, family })
	);
}

/**
 * Mandatory-thinking models never reach this builder with a toggle intent:
 * `normalizeReasoningRequest` drops `reasoning` when the model advertises no
 * off control, so `enabled` is already undefined here. The distinction stays an
 * authoritative catalog fact instead of a list maintained in routing code.
 */
export function buildChutesThinkingProviderOptionsPatch(
	request: GatewayStreamRequest,
	context: GatewayProviderContext,
	providerOptionsKey: string,
): ProviderOptionsPatch | undefined {
	const enabled = request.reasoning?.enabled;
	if (enabled === undefined) {
		return undefined;
	}

	const family = resolveModelFamily(context);
	let chatTemplateKwargs: Record<string, boolean> | undefined;
	if (normalizeRoutingValue(family) === "kimi-k2") {
		chatTemplateKwargs = enabled
			? { thinking: true, preserve_thinking: true }
			: { thinking: false };
	} else if (isQwenModel({ modelId: request.modelId, family })) {
		chatTemplateKwargs = { enable_thinking: enabled };
	}

	return chatTemplateKwargs
		? buildProviderAndAliasPatch({
				providerId: request.providerId,
				providerOptionsKey,
				bucketOptions: { chat_template_kwargs: chatTemplateKwargs },
			})
		: undefined;
}
