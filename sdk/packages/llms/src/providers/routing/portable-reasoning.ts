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

/** The AI SDK adapter a request goes through, and the model it targets. */
export interface PortableReasoningWire {
	adapter: AiSdkProviderOptionsTarget;
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

const PORTABLE_REASONING_PROVIDERS = new Set([
	"anthropic",
	"bedrock",
	"deepseek",
	"fireworks",
	"gemini",
	"google",
	"groq",
	"openai-native",
	"openai-codex",
	"ollama",
	"vertex",
	"xai",
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
 * Resolve reasoning intent owned by the AI SDK's portable top-level option.
 * Pass `wire` to fit the level to the target model's advertised efforts.
 */
export function resolvePortableReasoning(
	request: GatewayStreamRequest,
	wire?: PortableReasoningWire,
): AiSdkReasoning | undefined {
	const level = resolvePortableLevel(request);
	return level && wire ? snapToAdvertisedEffort(level, wire) : level;
}

function resolvePortableLevel(
	request: GatewayStreamRequest,
): AiSdkReasoning | undefined {
	const reasoning = request.reasoning;
	if (!reasoning) {
		return undefined;
	}
	const fullySupported = PORTABLE_REASONING_PROVIDERS.has(request.providerId);
	if (reasoning.enabled === false) {
		return fullySupported ? "none" : undefined;
	}
	if (typeof reasoning.budgetTokens === "number") {
		return undefined;
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

/**
 * Remove portable intent before provider options are composed. AI SDK ignores
 * top-level reasoning whenever reasoning controls also occur in providerOptions.
 */
export function withoutPortableReasoning(
	request: GatewayStreamRequest,
): GatewayStreamRequest {
	const normalizedRequest =
		request.reasoning?.enabled === false &&
		(request.reasoning.effort !== undefined ||
			request.reasoning.budgetTokens !== undefined)
			? { ...request, reasoning: { enabled: false } }
			: request;
	return resolvePortableReasoning(normalizedRequest)
		? { ...normalizedRequest, reasoning: undefined }
		: normalizedRequest;
}
