import type {
	GatewayProviderContext,
	GatewayStreamRequest,
} from "@cline/shared";
import type { CallSettings } from "ai";
import { usesBedrockPortableReasoning } from "./bedrock-reasoning";

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
 * Resolve reasoning intent owned by the AI SDK's portable top-level option.
 *
 * `context` gates provider/model combinations whose adapter cannot translate
 * the portable option safely (see `bedrock-reasoning.ts`). It is required so
 * that a caller cannot silently opt out of that gate.
 */
export function resolvePortableReasoning(
	request: GatewayStreamRequest,
	context: GatewayProviderContext,
): AiSdkReasoning | undefined {
	const reasoning = request.reasoning;
	if (!reasoning) {
		return undefined;
	}
	if (!usesBedrockPortableReasoning(request, context)) {
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
	context: GatewayProviderContext,
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
