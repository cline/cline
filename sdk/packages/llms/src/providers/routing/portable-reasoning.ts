import type {
	GatewayProviderContext,
	GatewayStreamRequest,
} from "@cline/shared";
import type { CallSettings } from "ai";
import {
	getModelReasoningControls,
	isBedrockOpenAIRequest,
	normalizeReasoningEffort,
} from "../model-facts";

export type AiSdkReasoning = NonNullable<CallSettings["reasoning"]>;

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

/**
 * Whether the resolved Bedrock model is known to lack reasoning support.
 *
 * `@ai-sdk/amazon-bedrock` unconditionally maps top-level reasoning into a
 * native `reasoningConfig`/`reasoning_effort` field for every non-Anthropic
 * model id — including models without reasoning support (Llama, Nova Pro,
 * Titan, custom ids). Bedrock rejects those requests, so portable reasoning
 * must be suppressed when the catalog explicitly reports no reasoning
 * capability. Unknown/custom models (absent capabilities) fail open so
 * reasoning-capable custom ids keep working.
 */
function bedrockModelLacksReasoning(
	request: GatewayStreamRequest,
	context: GatewayProviderContext | undefined,
): boolean {
	if (request.providerId !== "bedrock" || !context) {
		return false;
	}
	const capabilities = context.model.capabilities;
	if (capabilities === undefined) {
		return false;
	}
	if (capabilities.includes("reasoning")) {
		return false;
	}
	const reasoningOptions = context.model.reasoningOptions;
	if (reasoningOptions !== undefined && reasoningOptions.length > 0) {
		return false;
	}
	return true;
}

/**
 * Clamp a Bedrock effort to the model's advertised controls so catalog-known
 * models (e.g. GPT-OSS with low/medium/high) never emit an unsupported level
 * like `xhigh`/`max` that Bedrock rejects. Returns undefined when the model
 * advertises no usable effort values. Unknown/custom models fail open.
 */
function normalizeBedrockPortableEffort(
	effort: string,
	context: GatewayProviderContext | undefined,
): AiSdkReasoning | undefined {
	const fallback: AiSdkReasoning =
		effort === "max" ? "xhigh" : (effort as AiSdkReasoning);
	if (!context) {
		return fallback;
	}
	const reasoningOptions = context.model.reasoningOptions;
	if (reasoningOptions === undefined) {
		return fallback;
	}
	if (reasoningOptions.length === 0) {
		return undefined;
	}
	const controls = getModelReasoningControls(reasoningOptions);
	if (!controls || controls.efforts.length === 0) {
		return undefined;
	}
	const normalized = normalizeReasoningEffort(
		effort as Parameters<typeof normalizeReasoningEffort>[0],
		controls.efforts,
	);
	if (!normalized) {
		return undefined;
	}
	return normalized === "max" ? "xhigh" : (normalized as AiSdkReasoning);
}

/** Resolve reasoning intent owned by the AI SDK's portable top-level option. */
export function resolvePortableReasoning(
	request: GatewayStreamRequest,
	context?: GatewayProviderContext,
): AiSdkReasoning | undefined {
	const reasoning = request.reasoning;
	if (!reasoning || isBedrockOpenAIRequest(request)) {
		return undefined;
	}
	const fullySupported = PORTABLE_REASONING_PROVIDERS.has(request.providerId);
	if (reasoning.enabled === false) {
		if (!fullySupported) {
			return undefined;
		}
		return bedrockModelLacksReasoning(request, context) ? undefined : "none";
	}
	if (typeof reasoning.budgetTokens === "number") {
		return undefined;
	}
	if (reasoning.effort) {
		if (NON_PORTABLE_REASONING_PROVIDERS.has(request.providerId)) {
			return undefined;
		}
		if (bedrockModelLacksReasoning(request, context)) {
			return undefined;
		}
		if (request.providerId === "bedrock") {
			return normalizeBedrockPortableEffort(reasoning.effort, context);
		}
		return reasoning.effort === "max" ? "xhigh" : reasoning.effort;
	}
	if (
		reasoning.enabled === true &&
		!NON_PORTABLE_REASONING_PROVIDERS.has(request.providerId)
	) {
		if (bedrockModelLacksReasoning(request, context)) {
			return undefined;
		}
		if (request.providerId === "bedrock") {
			return normalizeBedrockPortableEffort("medium", context);
		}
		return "medium";
	}
	return undefined;
}

/**
 * Remove portable intent before provider options are composed. AI SDK ignores
 * top-level reasoning whenever reasoning controls also occur in providerOptions.
 */
export function withoutPortableReasoning(
	request: GatewayStreamRequest,
	context?: GatewayProviderContext,
): GatewayStreamRequest {
	const normalizedRequest =
		request.reasoning?.enabled === false &&
		(request.reasoning.effort !== undefined ||
			request.reasoning.budgetTokens !== undefined)
			? { ...request, reasoning: { enabled: false } }
			: request;
	return resolvePortableReasoning(normalizedRequest, context)
		? { ...normalizedRequest, reasoning: undefined }
		: normalizedRequest;
}
