import {
	createGateway,
	createHandlerAsync,
	hasRegisteredHandler,
	MODEL_COLLECTIONS_BY_PROVIDER_ID,
	normalizeProviderId,
} from "@cline/llms";
import type {
	AgentConfig,
	AgentModel,
	BasicLogger,
	GatewayModelDefinition,
	ITelemetryService,
	ModelInfo,
} from "@cline/shared";
import { createAgentModelFromApiHandler } from "./apihandler-agent-model-adapter";
import type { ProviderConfig } from "./provider-settings";

function compactOptions(
	options: Record<string, unknown>,
): Record<string, unknown> | undefined {
	const compacted = Object.fromEntries(
		Object.entries(options).filter(([, value]) => value !== undefined),
	);
	return Object.keys(compacted).length > 0 ? compacted : undefined;
}

function usesOpenAICompatibleClient(config: ProviderConfig): boolean {
	return (
		config.providerId === "openai-compatible" ||
		config.clientType === "openai-compatible"
	);
}

function buildGatewayProviderOptions(
	config: ProviderConfig,
): Record<string, unknown> | undefined {
	const options: Record<string, unknown> = {
		region: config.region,
		apiLine: config.apiLine,
		openRouterProviderSorting: config.openRouterProviderSorting,
		modelCatalog: config.modelCatalog,
	};

	if (usesOpenAICompatibleClient(config)) {
		Object.assign(options, {
			apiVersion: config.azure?.apiVersion,
			useIdentity: config.azure?.useIdentity,
		});
	}

	if (config.providerId === "bedrock") {
		Object.assign(options, {
			authentication: config.aws?.authentication,
			profile: config.aws?.profile,
			accessKeyId: config.aws?.accessKey,
			secretAccessKey: config.aws?.secretKey,
			sessionToken: config.aws?.sessionToken,
			usePromptCache: config.aws?.usePromptCache,
			useCrossRegionInference: config.useCrossRegionInference,
			useGlobalInference: config.useGlobalInference,
			endpoint: config.aws?.endpoint,
			customModelBaseId: config.aws?.customModelBaseId,
		});
	}

	if (config.providerId === "vertex") {
		const gcpRegion = config.gcp?.region ?? config.region;
		Object.assign(options, {
			project: config.gcp?.projectId,
			projectId: config.gcp?.projectId,
			location: gcpRegion,
			region: gcpRegion,
		});
	}

	if (config.providerId === "sapaicore") {
		Object.assign(options, config.sap);
	}

	return compactOptions(options);
}

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
		temperature: config.temperature,
		reasoningEffort: config.reasoningEffort,
		thinkingBudgetTokens: config.thinkingBudgetTokens,
		thinking: config.thinking,
		logger,
		extensionContext: config.extensionContext,
	};

	// Host-registered custom handlers (e.g. VS Code LM, which needs the host's
	// `vscode.lm` API) are not part of the gateway. When a handler is registered
	// for this provider, adapt its `ApiHandler` surface onto the `AgentModel`
	// contract the runtime expects. The handler is built lazily (via
	// `createHandlerAsync`) on the first stream so that providers registered
	// with `registerAsyncHandler` resolve correctly.
	if (
		hasRegisteredHandler(
			normalizeProviderId(normalizedProviderConfig.providerId),
		)
	) {
		return createAgentModelFromApiHandler(() =>
			createHandlerAsync(normalizedProviderConfig),
		);
	}

	return createGateway({
		// Forward the host-provided fetch so inference honors proxy/CA config on
		// JetBrains and CLI, where the global fetch is not proxy-aware. Without
		// this the agent loop falls back to bare global fetch and corporate
		// proxy/self-signed CA setups fail.
		fetch: normalizedProviderConfig.fetch,
		providerConfigs: [
			{
				providerId: normalizedProviderConfig.providerId,
				apiKey: normalizedProviderConfig.apiKey,
				baseUrl: normalizedProviderConfig.baseUrl,
				headers: normalizedProviderConfig.headers,
				fetch: normalizedProviderConfig.fetch,
				options: buildGatewayProviderOptions(normalizedProviderConfig),
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
		{
			maxTokens: normalizedProviderConfig.maxOutputTokens,
			temperature: normalizedProviderConfig.temperature,
		},
	);
}
