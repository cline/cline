import type {
	GatewayProviderContext,
	GatewayStreamRequest,
} from "@cline/shared";
import type { AnthropicReasoningRequestPolicy } from "./anthropic-compatible";
import type { ProviderOptionsPatch } from "./utils";

export type AiSdkProviderOptionsTarget =
	| "openai"
	| "openai-compatible"
	| "anthropic"
	| "google"
	| "vertex"
	| "bedrock"
	| "mistral"
	| "claude-code"
	| "openai-codex"
	| "opencode"
	| "dify";

export type ProviderOptionSuppression = {
	genericThinking?: boolean;
	genericEffort?: boolean;
	genericFanout?: boolean;
};

export type ProviderOptionMatchInput = {
	request: GatewayStreamRequest;
	context: GatewayProviderContext;
	providerOptionsKey: string;
	target: AiSdkProviderOptionsTarget;
	modelFamily?: string;
	isAnthropicCompatibleModelId: boolean;
	anthropicReasoningPolicyKind?: AnthropicReasoningRequestPolicy["kind"];
};

export type ProviderOptionBuildInput = ProviderOptionMatchInput & {
	compatibleOptions: Record<string, unknown>;
	anthropicOptions: Record<string, unknown>;
	suppressions: ProviderOptionSuppression;
};

export type ProviderOptionRule = {
	id: string;
	phase:
		| "adapter"
		| "provider"
		| "provider-fanout"
		| "provider-reasoning"
		| "model-family"
		| "model-overlay";
	description: string;
	applies(input: ProviderOptionMatchInput): boolean;
	suppresses?: ProviderOptionSuppression;
	build(input: ProviderOptionBuildInput): ProviderOptionsPatch | undefined;
};

export type MatchedProviderOptionRule = {
	rule: ProviderOptionRule;
};

export function inferProviderOptionsTarget(
	providerId: string,
): AiSdkProviderOptionsTarget {
	switch (providerId) {
		case "openai-native":
			return "openai";
		case "anthropic":
			return "anthropic";
		case "google":
		case "gemini":
			return "google";
		case "vertex":
			return "vertex";
		case "bedrock":
			return "bedrock";
		case "mistral":
			return "mistral";
		case "claude-code":
			return "claude-code";
		case "openai-codex":
			return "openai-codex";
		case "opencode":
			return "opencode";
		case "dify":
			return "dify";
		default:
			return "openai-compatible";
	}
}
