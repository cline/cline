import type { BasicLogger, ExtensionContext, ModelInfo } from "@cline/shared";
import {
	BUILT_IN_PROVIDER,
	BUILT_IN_PROVIDER_IDS,
	type BuiltInProviderId,
	isBuiltInProviderId,
	normalizeProviderId,
} from "./ids";

export {
	BUILT_IN_PROVIDER,
	BUILT_IN_PROVIDER_IDS,
	type BuiltInProviderId,
	isBuiltInProviderId,
	normalizeProviderId,
};

export type ProviderId = "bedrock";
export type ProviderCategory = "bedrock";

export type ProviderCapability =
	| "reasoning"
	| "prompt-cache"
	| "streaming"
	| "tools"
	| "vision"
	| "computer-use";

export interface BedrockConnection {
	region: string;
	profile?: string;
	endpoint?: string;
	caBundlePath?: string;
	controlPlaneEndpoint?: string;
}

export interface ReasoningConfig {
	reasoningEffort?: "low" | "medium" | "high" | "xhigh";
	thinkingBudgetTokens?: number;
	thinking?: boolean;
}

export interface ProviderConfig extends ReasoningConfig {
	providerId: "bedrock";
	modelId: string;
	connection: BedrockConnection;
	workspaceRoot?: string;
	modelInfo?: ModelInfo;
	knownModels?: Record<string, ModelInfo>;
	maxInputTokens?: number;
	maxOutputTokens?: number;
	temperature?: number;
	onRetryAttempt?: (
		attempt: number,
		maxRetries: number,
		delay: number,
		error: unknown,
	) => void;
	abortSignal?: AbortSignal;
	logger?: BasicLogger;
	extensionContext?: ExtensionContext;
}

export function hasCapability(
	config: ProviderConfig,
	capability: ProviderCapability,
): boolean {
	return (
		config.modelInfo?.capabilities?.includes(
			capability === "vision" ? "images" : capability,
		) ?? false
	);
}

export function supportsReasoning(config: ProviderConfig): boolean {
	return hasCapability(config, "reasoning");
}

export function supportsPromptCache(config: ProviderConfig): boolean {
	return hasCapability(config, "prompt-cache");
}

export function resolveRoutingProviderId(_config: ProviderConfig): "bedrock" {
	return "bedrock";
}
