import type {
	GatewayProviderContext,
	GatewayStreamRequest,
	ReasoningEffort,
} from "@cline/shared";
import type { CallSettings } from "ai";
import {
	getModelReasoningControls,
	normalizeReasoningEffort,
} from "../model-facts";
import type { AiSdkProviderOptionsTarget } from "./provider-options-types";

export type AiSdkReasoning = NonNullable<CallSettings["reasoning"]>;

/**
 * The model a request targets and, when known, the AI SDK adapter it goes
 * through. The adapter is only needed to fit a level to the model's
 * advertised effort ladder.
 */
export interface PortableReasoningWire {
	adapter?: AiSdkProviderOptionsTarget;
	context: GatewayProviderContext;
}

/**
 * Adapters that put the top-level `reasoning` value on the request unchanged
 * (`@ai-sdk/openai-compatible` sends it as `reasoning_effort`). The other
 * adapters translate the portable level through their own per-model effort
 * maps, so the gateway leaves the level to them.
 */
const VERBATIM_REASONING_ADAPTERS = new Set<AiSdkProviderOptionsTarget>([
	"cline",
	"openai-compatible",
]);

const NON_PORTABLE_REASONING_PROVIDERS = new Set([
	"claude-code",
	"dify",
	"mistral",
	"opencode",
	"sapaicore",
]);

function toPortableLevel(effort: ReasoningEffort): AiSdkReasoning {
	// TODO: pass "max" through once the AI SDK portable reasoning setting
	// accepts it (vercel/ai#22043).
	return effort === "max" ? "xhigh" : effort;
}

/**
 * Snap a level to the model's advertised effort ladder when the adapter sends
 * it verbatim, since endpoints reject levels outside their ladder. When the
 * nearest advertised level cannot be expressed portably ("max"), keep the
 * requested level rather than send less effort than the user picked.
 */
function snapToAdvertisedEffort(
	level: AiSdkReasoning,
	wire: PortableReasoningWire,
): AiSdkReasoning {
	if (
		level === "none" ||
		level === "provider-default" ||
		!wire.adapter ||
		!VERBATIM_REASONING_ADAPTERS.has(wire.adapter)
	) {
		return level;
	}
	const efforts = getModelReasoningControls(
		wire.context.model.reasoningOptions,
	)?.efforts;
	if (!efforts?.length) {
		return level;
	}
	const nearest = normalizeReasoningEffort(level, efforts);
	return nearest === undefined || nearest === "max" ? level : nearest;
}

/**
 * Adapters that turn "none" into the model's lowest thinking level, guessed
 * from the model id, instead of forwarding it. The guess can be a level the
 * model rejects.
 */
const LOWEST_LEVEL_DISABLE_ADAPTERS = new Set<AiSdkProviderOptionsTarget>([
	"google",
	"vertex",
]);

/**
 * Send a disable only to models that accept one: "none" when the catalog
 * advertises an off option (`none` or a toggle), and nothing when it does not,
 * so the model keeps its default. A model the catalog does not describe keeps
 * "none", except on adapters that would guess a level for it.
 */
function fitDisableToModel(
	wire: PortableReasoningWire,
): AiSdkReasoning | undefined {
	const controls = getModelReasoningControls(
		wire.context.model.reasoningOptions,
	);
	if (!controls) {
		return wire.adapter && LOWEST_LEVEL_DISABLE_ADAPTERS.has(wire.adapter)
			? undefined
			: "none";
	}
	return controls.supportsOff ? "none" : undefined;
}

/**
 * Resolve reasoning intent owned by the AI SDK's portable top-level option.
 * Pass `wire` to skip disabling reasoning on models known not to reason, and
 * to fit the level to the target model's advertised efforts.
 */
export function resolvePortableReasoning(
	request: GatewayStreamRequest,
	wire?: PortableReasoningWire,
): AiSdkReasoning | undefined {
	const level = resolvePortableLevel(request, wire?.context);
	if (!level || !wire) {
		return level;
	}
	return level === "none"
		? fitDisableToModel(wire)
		: snapToAdvertisedEffort(level, wire);
}

/**
 * A model without known capabilities may reason, so only a capability list
 * that omits reasoning rules it out.
 */
function mayReason(context: GatewayProviderContext | undefined): boolean {
	const capabilities = context?.model.capabilities;
	return !capabilities || capabilities.includes("reasoning");
}

function resolvePortableLevel(
	request: GatewayStreamRequest,
	context: GatewayProviderContext | undefined,
): AiSdkReasoning | undefined {
	const reasoning = request.reasoning;
	if (!reasoning) {
		return undefined;
	}
	if (reasoning.enabled === false) {
		// Adapters that forward the level verbatim (`reasoning_effort`) would
		// otherwise send nothing, leaving default-on reasoning models thinking.
		return NON_PORTABLE_REASONING_PROVIDERS.has(request.providerId) ||
			!mayReason(context)
			? undefined
			: "none";
	}
	if (reasoning.effort) {
		if (NON_PORTABLE_REASONING_PROVIDERS.has(request.providerId)) {
			return undefined;
		}
		return toPortableLevel(reasoning.effort);
	}
	return reasoning.enabled === true &&
		!NON_PORTABLE_REASONING_PROVIDERS.has(request.providerId)
		? "medium"
		: undefined;
}

/** Provider-option keys that carry a native reasoning control. */
const NATIVE_REASONING_CONTROL_KEYS = [
	"effort",
	"reasoning",
	"reasoningEffort",
	"think",
	"thinking",
	"thinkingConfig",
] as const;

export function hasNativeReasoningControls(
	providerOptions: Record<string, unknown>,
): boolean {
	return Object.values(providerOptions).some(
		(bucket) =>
			!!bucket &&
			typeof bucket === "object" &&
			NATIVE_REASONING_CONTROL_KEYS.some((key) => key in bucket),
	);
}

/**
 * The portable option applies only when no provider-option rule already
 * encodes reasoning natively (an exact budget, a native toggle), so a request
 * never carries both shapes.
 */
export function reconcilePortableReasoning(
	level: AiSdkReasoning | undefined,
	providerOptions: Record<string, unknown>,
): AiSdkReasoning | undefined {
	return hasNativeReasoningControls(providerOptions) ? undefined : level;
}

/**
 * Remove portable intent before provider options are composed. AI SDK ignores
 * top-level reasoning whenever reasoning controls also occur in providerOptions.
 * A disable or an exact budget is kept: providers with native toggles (GLM,
 * MiniMax, Kimi, OpenRouter) or budget fields still encode it, and
 * `reconcilePortableReasoning` then drops the portable value.
 */
export function withoutPortableReasoning(
	request: GatewayStreamRequest,
	context?: GatewayProviderContext,
): GatewayStreamRequest {
	if (request.reasoning?.enabled === false) {
		return request.reasoning.effort !== undefined ||
			request.reasoning.budgetTokens !== undefined
			? { ...request, reasoning: { enabled: false } }
			: request;
	}
	if (typeof request.reasoning?.budgetTokens === "number") {
		return request;
	}
	return resolvePortableReasoning(request, context ? { context } : undefined)
		? { ...request, reasoning: undefined }
		: request;
}
