import type {
	GatewayProviderContext,
	GatewayStreamRequest,
} from "@cline/shared";
import type { ProviderOptionsPatch } from "./utils";

export type AiSdkProviderOptionsTarget =
	| "cline"
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
	| "dify"
	| "ollama"
	| "sapaicore";

export type ProviderOptionSuppression = {
	genericThinking?: boolean;
	genericFanout?: boolean;
};

export type ProviderOptionMatchInput = {
	request: GatewayStreamRequest;
	context: GatewayProviderContext;
	providerOptionsKey: string;
	target: AiSdkProviderOptionsTarget;
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
		case "cline":
		case "cline-pass":
			return "cline";
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
		case "ollama":
			return "ollama";
		case "sapaicore":
			return "sapaicore";
		default:
			return "openai-compatible";
	}
}
