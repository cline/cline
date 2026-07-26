import {
	BEDROCK_MODELS,
	createBedrockAgentModel,
	type ProviderConfig,
} from "@bedrock-coder/llms";
import type {
	AgentConfig,
	AgentModel,
	BasicLogger,
	ModelInfo,
} from "@bedrock-coder/shared";

export function resolveKnownModelsFromConfig(
	config: AgentConfig,
): Record<string, ModelInfo> {
	const providerConfig = config.providerConfig as ProviderConfig | undefined;
	return providerConfig?.knownModels ?? config.knownModels ?? BEDROCK_MODELS;
}

export function createAgentModelFromConfig(
	config: AgentConfig,
	logger: BasicLogger | undefined,
): AgentModel {
	const configured = config.providerConfig as ProviderConfig | undefined;
	const providerConfig: ProviderConfig = {
		...(configured?.providerId === "bedrock" ? configured : {
			providerId: "bedrock",
			connection: { region: "us-east-1" },
		}),
		providerId: "bedrock",
		modelId: config.modelId,
		knownModels: resolveKnownModelsFromConfig(config),
		maxOutputTokens: config.maxTokensPerTurn,
		temperature: config.temperature,
		reasoningEffort: config.reasoningEffort,
		thinkingBudgetTokens: config.thinkingBudgetTokens,
		thinking: config.thinking,
		logger,
		extensionContext: config.extensionContext,
	};
	return createBedrockAgentModel(providerConfig);
}
