import { createGateway, MODEL_COLLECTIONS_BY_PROVIDER_ID } from "@cline/llms";
import type {
	AgentConfig,
	AgentModel,
	BasicLogger,
	GatewayModelDefinition,
	ITelemetryService,
	ModelInfo,
} from "@cline/shared";
import type { ProviderConfig } from "./provider-settings";

export function resolveKnownModelsFromConfig(
	config: AgentConfig,
): Record<string, ModelInfo> | undefined {
	const pc = config.providerConfig as ProviderConfig | undefined;
	if (pc?.knownModels) {
		return pc.knownModels;
	}
	if (config.knownModels) {
		return config.knownModels;
	}
	return (
		MODEL_COLLECTIONS_BY_PROVIDER_ID[config.providerId]?.models ?? undefined
	);
}

function toGatewayCapabilities(
	capabilities: ModelInfo["capabilities"],
): GatewayModelDefinition["capabilities"] {
	if (!capabilities?.length) {
		return undefined;
	}

	const mapped = new Set<
		NonNullable<GatewayModelDefinition["capabilities"]>[number]
	>();
	for (const capability of capabilities) {
		switch (capability) {
			case "tools":
			case "reasoning":
			case "prompt-cache":
			case "images":
				mapped.add(capability);
				break;
			case "structured_output":
				mapped.add("structured-output");
				break;
			default:
				mapped.add("text");
		}
	}

	mapped.add("text");
	return [...mapped];
}

function toGatewayConfiguredModel(
	id: string,
	model: ModelInfo,
): Omit<GatewayModelDefinition, "providerId"> {
	return {
		id,
		name: model.name ?? id,
		description: model.description,
		contextWindow: model.contextWindow,
		maxInputTokens: model.maxInputTokens,
		maxOutputTokens: model.maxTokens,
		capabilities: toGatewayCapabilities(model.capabilities),
		metadata: {
			family: model.family,
			pricing: model.pricing,
			status: model.status,
			releaseDate: model.releaseDate,
		},
	};
}

function setGatewayOption(
	options: Record<string, unknown>,
	key: string,
	value: unknown,
): void {
	if (value !== undefined) {
		options[key] = value;
	}
}

function toGatewayProviderOptions(
	config: ProviderConfig,
): Record<string, unknown> | undefined {
	const options: Record<string, unknown> = {};
	const location = config.region ?? config.gcp?.region;

	setGatewayOption(options, "region", location);
	setGatewayOption(options, "project", config.gcp?.projectId);
	setGatewayOption(options, "projectId", config.gcp?.projectId);
	setGatewayOption(options, "location", location);
	setGatewayOption(options, "accessKeyId", config.aws?.accessKey);
	setGatewayOption(options, "secretAccessKey", config.aws?.secretKey);
	setGatewayOption(options, "sessionToken", config.aws?.sessionToken);
	setGatewayOption(options, "authentication", config.aws?.authentication);
	setGatewayOption(options, "profile", config.aws?.profile);
	setGatewayOption(options, "endpoint", config.aws?.endpoint);
	setGatewayOption(options, "customModelBaseId", config.aws?.customModelBaseId);
	setGatewayOption(options, "apiVersion", config.azure?.apiVersion);
	setGatewayOption(options, "useIdentity", config.azure?.useIdentity);
	setGatewayOption(options, "mode", config.oca?.mode);
	setGatewayOption(
		options,
		"usePromptCache",
		config.aws?.usePromptCache ?? config.oca?.usePromptCache,
	);

	for (const source of [
		config.codex,
		config.claudeCode,
		config.opencode,
		config.sap,
	]) {
		for (const [key, value] of Object.entries(source ?? {})) {
			setGatewayOption(options, key, value);
		}
	}

	return Object.keys(options).length > 0 ? options : undefined;
}

export function createAgentModelFromConfig(
	config: AgentConfig,
	logger: BasicLogger | undefined,
	telemetry?: ITelemetryService,
): AgentModel {
	const pc = config.providerConfig as ProviderConfig | undefined;
	const baseProviderConfig =
		pc?.providerId === config.providerId ? pc : undefined;
	const normalizedProviderConfig: ProviderConfig = {
		...(baseProviderConfig ?? {}),
		providerId: config.providerId,
		modelId: config.modelId,
		apiKey: config.apiKey ?? baseProviderConfig?.apiKey,
		baseUrl: config.baseUrl ?? baseProviderConfig?.baseUrl,
		headers: config.headers ?? baseProviderConfig?.headers,
		knownModels: resolveKnownModelsFromConfig(config),
		maxOutputTokens: config.maxTokensPerTurn,
		reasoningEffort: config.reasoningEffort,
		thinkingBudgetTokens: config.thinkingBudgetTokens,
		thinking: config.thinking,
		logger,
		extensionContext: config.extensionContext,
	};
	return createGateway({
		providerConfigs: [
			{
				providerId: normalizedProviderConfig.providerId,
				apiKey: normalizedProviderConfig.apiKey,
				baseUrl: normalizedProviderConfig.baseUrl,
				headers: normalizedProviderConfig.headers,
				options: toGatewayProviderOptions(normalizedProviderConfig),
				models: normalizedProviderConfig.knownModels
					? Object.entries(normalizedProviderConfig.knownModels).map(
							([id, model]) => toGatewayConfiguredModel(id, model),
						)
					: undefined,
			},
		],
		logger,
		telemetry:
			telemetry ?? config.telemetry ?? config.extensionContext?.telemetry,
	}).createAgentModel(
		{
			providerId: normalizedProviderConfig.providerId,
			modelId: normalizedProviderConfig.modelId,
		},
		{ maxTokens: normalizedProviderConfig.maxOutputTokens },
	);
}
