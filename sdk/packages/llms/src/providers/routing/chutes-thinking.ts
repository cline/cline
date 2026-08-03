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

/**
 * Which `chat_template_kwargs` field carries the thinking switch for each
 * family Chutes serves. models.dev states *whether* a model has a toggle;
 * this table states *how* that toggle is spelled on the wire, which the
 * catalog does not describe.
 *
 * Every entry is taken from the model's published chat template and confirmed
 * against the live endpoint, where `reasoning_content` is present with the
 * switch on and absent with it off.
 */
const CHUTES_THINKING_FIELD: ReadonlyMap<
	string,
	"thinking" | "enable_thinking"
> = new Map([
	["kimi-k2", "thinking"],
	["kimi-k3", "thinking"],
	["glm", "thinking"],
	["deepseek", "thinking"],
	["deepseek-flash", "thinking"],
	["gemma", "enable_thinking"],
]);

/**
 * Kimi K2's template takes a second flag that keeps earlier reasoning in
 * context. No other family Chutes serves declares it — K3's template does not
 * either — so everything else is sent only the switch its own template
 * declares, rather than a field it would silently drop.
 */
const CHUTES_PRESERVE_THINKING_FAMILIES: ReadonlySet<string> = new Set([
	"kimi-k2",
]);

function resolveChutesThinkingField(
	request: Pick<GatewayStreamRequest, "modelId">,
	context: GatewayProviderContext,
): { field: "thinking" | "enable_thinking"; family: string } | undefined {
	const family = resolveModelFamily(context);
	const normalized = normalizeRoutingValue(family) ?? "";
	const mapped = CHUTES_THINKING_FIELD.get(normalized);
	if (mapped) {
		return { field: mapped, family: normalized };
	}
	// Qwen checkpoints are recognized by model id as well as by family, since
	// Chutes serves several that predate a family entry.
	return isQwenModel({ modelId: request.modelId, family })
		? { field: "enable_thinking", family: normalized }
		: undefined;
}

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

	return resolveChutesThinkingField(request, context) !== undefined;
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

	const resolved = resolveChutesThinkingField(request, context);
	if (!resolved) {
		return undefined;
	}

	let chatTemplateKwargs: Record<string, boolean>;
	if (resolved.field === "enable_thinking") {
		chatTemplateKwargs = { enable_thinking: enabled };
	} else if (
		enabled &&
		CHUTES_PRESERVE_THINKING_FAMILIES.has(resolved.family)
	) {
		chatTemplateKwargs = { thinking: true, preserve_thinking: true };
	} else {
		chatTemplateKwargs = { thinking: enabled };
	}

	return buildProviderAndAliasPatch({
		providerId: request.providerId,
		providerOptionsKey,
		bucketOptions: { chat_template_kwargs: chatTemplateKwargs },
	});
}
