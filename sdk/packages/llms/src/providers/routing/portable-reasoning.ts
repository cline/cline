import type { GatewayStreamRequest } from "@cline/shared";
import type { CallSettings } from "ai";

export type AiSdkReasoning = NonNullable<CallSettings["reasoning"]>;

/**
 * Providers whose AI SDK package maps the full portable scale, including the
 * explicit-disable value "none". Providers routed through
 * `@ai-sdk/openai-compatible` (deepseek, fireworks, groq, xai, ...) are
 * deliberately absent: that package forwards effort levels as
 * `reasoning_effort` but silently drops "none", so an explicit disable would
 * vanish from the wire. Their disable requests must keep riding the native
 * provider-option rules (e.g. DeepSeek `thinking.type = "disabled"`,
 * Fireworks `reasoning_effort: "none"`).
 */
const PORTABLE_REASONING_DISABLE_PROVIDERS = new Set([
	"anthropic",
	"bedrock",
	"gemini",
	"google",
	"ollama",
	"openai-codex",
	"openai-native",
	"vertex",
]);

const NON_PORTABLE_REASONING_PROVIDERS = new Set([
	"claude-code",
	"dify",
	"mistral",
	"opencode",
	"sapaicore",
]);

/** Resolve reasoning intent owned by the AI SDK's portable top-level option. */
export function resolvePortableReasoning(
	request: GatewayStreamRequest,
): AiSdkReasoning | undefined {
	const reasoning = request.reasoning;
	if (!reasoning) {
		return undefined;
	}
	if (reasoning.enabled === false) {
		return PORTABLE_REASONING_DISABLE_PROVIDERS.has(request.providerId)
			? "none"
			: undefined;
	}
	if (typeof reasoning.budgetTokens === "number") {
		return undefined;
	}
	if (reasoning.effort) {
		if (NON_PORTABLE_REASONING_PROVIDERS.has(request.providerId)) {
			return undefined;
		}
		return reasoning.effort === "max" ? "xhigh" : reasoning.effort;
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
