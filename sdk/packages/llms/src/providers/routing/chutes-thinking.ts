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
 * Chutes Qwen-family models whose thinking mode cannot be disabled at the
 * wire level. Membership is explicit and auditable: new thinking-only models
 * must be added deliberately, not inferred from display names.
 */
const CHUTES_THINKING_ONLY_QWEN_IDS: ReadonlySet<string> = new Set([
	"qwen/qwen3-235b-a22b-thinking-2507-tee",
]);

function isThinkingOnlyQwen(
	request: Pick<GatewayStreamRequest, "modelId">,
): boolean {
	const modelId = normalizeRoutingValue(request.modelId);
	return modelId ? CHUTES_THINKING_ONLY_QWEN_IDS.has(modelId) : false;
}

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
	} else if (
		isQwenModel({ modelId: request.modelId, family }) &&
		!isThinkingOnlyQwen(request)
	) {
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
