export {
	OPENAI_COMPATIBLE_PROVIDERS,
	type ProviderDefaults,
	resolveProviderConfig,
} from "./runtime/provider-defaults";
export { registerAsyncHandler, registerHandler } from "./runtime/registry";
export {
	type ApiHandler,
	type BuiltInProviderId,
	type HandlerFactory,
	type LazyHandlerFactory,
	normalizeProviderId,
	type ProviderCapability,
	type ProviderConfig,
	type ProviderId,
	resolveRoutingProviderId,
} from "./types";

import {
	DEFAULT_EXTERNAL_OCA_BASE_URL,
	DEFAULT_INTERNAL_OCA_BASE_URL,
	MODEL_COLLECTION_LIST,
} from "../models/provider-catalog";
import type { ProviderClient } from "../models/types";
import { AnthropicHandler } from "./handlers/anthropic-base";
import { AskSageHandler } from "./handlers/asksage";
import { BedrockHandler } from "./handlers/bedrock-base";
import {
	ClaudeCodeHandler,
	CodexHandler,
	DifyHandler,
	MistralHandler,
	OpenCodeHandler,
	SapAiCoreHandler,
} from "./handlers/community-sdk";
import { GeminiHandler } from "./handlers/gemini-base";
import { OpenAIBaseHandler } from "./handlers/openai-base";
import { OpenAICompatibleHandler } from "./handlers/openai-compatible";
import { OpenAIResponsesHandler } from "./handlers/openai-responses";
import { VertexHandler } from "./handlers/vertex";
import {
	buildProviderClientMap,
	isOpenAICompatibleProvider,
	OPENAI_COMPATIBLE_PROVIDERS,
	type ProviderDefaults,
	resolveProviderConfig,
} from "./runtime/provider-defaults";
import {
	getRegisteredHandler,
	getRegisteredHandlerAsync,
	hasRegisteredHandler,
	isRegisteredHandlerAsync,
} from "./runtime/registry";
import {
	ApiFormat,
	type ApiHandler,
	BUILT_IN_PROVIDER,
	normalizeProviderId,
	type ProviderConfig,
	type ProviderId,
	resolveRoutingProviderId,
} from "./types";

function withNormalizedProviderId(config: ProviderConfig): ProviderConfig {
	const normalizedProviderId = normalizeProviderId(config.providerId);
	if (normalizedProviderId === config.providerId) {
		return config;
	}
	return {
		...config,
		providerId: normalizedProviderId,
	};
}

function resolveOcaBaseUrl(
	config: ProviderConfig,
	providerDefaults?: { baseUrl: string },
): string {
	if (config.baseUrl) {
		return config.baseUrl;
	}
	if (config.oca?.mode === "internal") {
		return DEFAULT_INTERNAL_OCA_BASE_URL;
	}
	return providerDefaults?.baseUrl ?? DEFAULT_EXTERNAL_OCA_BASE_URL;
}

function resolveOcaApiFormat(config: ProviderConfig): string | undefined {
	const modelId = config.modelId;
	return (
		config.modelInfo?.apiFormat ??
		(modelId ? config.knownModels?.[modelId]?.apiFormat : undefined)
	);
}

function createOcaHandler(config: ProviderConfig): ApiHandler {
	const apiFormat = resolveOcaApiFormat(config);
	if (apiFormat === ApiFormat.OPENAI_RESPONSES) {
		return new OpenAIResponsesHandler(config);
	}
	return new OpenAICompatibleHandler(config);
}

function mergeProviderDefaults(
	config: ProviderConfig,
	defaults: ProviderDefaults,
): ProviderConfig {
	return {
		...config,
		baseUrl:
			resolveRoutingProviderId(config) === BUILT_IN_PROVIDER.OCA
				? resolveOcaBaseUrl(config, defaults)
				: (config.baseUrl ?? defaults.baseUrl),
		modelId: config.modelId ?? defaults.modelId,
		knownModels: config.knownModels ?? defaults.knownModels,
		capabilities: config.capabilities ?? defaults.capabilities,
	};
}

type InternalHandlerFactory = (config: ProviderConfig) => ApiHandler;

let providerClientMap: Record<string, ProviderClient> | undefined;
function getProviderClientMap(): Record<string, ProviderClient> {
	if (!providerClientMap) {
		providerClientMap = buildProviderClientMap();
	}
	return providerClientMap;
}

const PROVIDER_HANDLER_OVERRIDES: Record<string, InternalHandlerFactory> = {
	[BUILT_IN_PROVIDER.CLAUDE_CODE]: (config) => new ClaudeCodeHandler(config),
	[BUILT_IN_PROVIDER.OPENAI_CODEX]: (config) => new CodexHandler(config),
	[BUILT_IN_PROVIDER.OPENCODE]: (config) => new OpenCodeHandler(config),
	[BUILT_IN_PROVIDER.SAPAICORE]: (config) => new SapAiCoreHandler(config),
	[BUILT_IN_PROVIDER.MISTRAL]: (config) => new MistralHandler(config),
	[BUILT_IN_PROVIDER.DIFY]: (config) => new DifyHandler(config),
	[BUILT_IN_PROVIDER.ASKSAGE]: (config) => new AskSageHandler(config),
	[BUILT_IN_PROVIDER.OCA]: (config) => createOcaHandler(config),
};

const CLIENT_HANDLER_FACTORIES: Partial<
	Record<ProviderClient, InternalHandlerFactory>
> = {
	anthropic: (config) => new AnthropicHandler(config),
	gemini: (config) => new GeminiHandler(config),
	vertex: (config) => new VertexHandler(config),
	bedrock: (config) => new BedrockHandler(config),
	openai: (config) => new OpenAIResponsesHandler(config),
	fetch: (config) => new OpenAIBaseHandler(config),
	"ai-sdk-community": (config) => new OpenAIBaseHandler(config),
	"openai-compatible": (config) => new OpenAICompatibleHandler(config),
};

function createBuiltInHandler(config: ProviderConfig): ApiHandler | undefined {
	const routingProviderId = resolveRoutingProviderId(config);

	const override = PROVIDER_HANDLER_OVERRIDES[routingProviderId];
	if (override) {
		return override(config);
	}

	const clientType = getProviderClientMap()[routingProviderId];
	if (clientType) {
		const factory = CLIENT_HANDLER_FACTORIES[clientType];
		if (factory) {
			return factory(config);
		}
	}

	return undefined;
}

export function createHandler(config: ProviderConfig): ApiHandler {
	const normalizedConfig = withNormalizedProviderId(config);
	const { providerId } = normalizedConfig;
	const routingProviderId = resolveRoutingProviderId(normalizedConfig);

	if (hasRegisteredHandler(providerId)) {
		if (isRegisteredHandlerAsync(providerId)) {
			throw new Error(
				`Handler for "${providerId}" is registered as async. Use createHandlerAsync() instead.`,
			);
		}
		const handler = getRegisteredHandler(providerId, normalizedConfig);
		if (handler) {
			return handler;
		}
	}

	const builtInHandler = createBuiltInHandler({
		...normalizedConfig,
		routingProviderId,
	});
	if (builtInHandler) {
		return builtInHandler;
	}

	if (isOpenAICompatibleProvider(routingProviderId)) {
		if (
			normalizedConfig.modelCatalog?.loadLatestOnInit ||
			normalizedConfig.modelCatalog?.loadPrivateOnAuth
		) {
			throw new Error(
				`Provider "${providerId}" has runtime model refresh enabled. Use createHandlerAsync() to allow async model refresh.`,
			);
		}
		const providerDefaults = OPENAI_COMPATIBLE_PROVIDERS[routingProviderId];
		const mergedConfig = mergeProviderDefaults(
			{ ...normalizedConfig, routingProviderId },
			providerDefaults,
		);
		return (
			createBuiltInHandler(mergedConfig) ??
			new OpenAICompatibleHandler(mergedConfig)
		);
	}

	return normalizedConfig.baseUrl
		? new OpenAICompatibleHandler({ ...normalizedConfig, routingProviderId })
		: new OpenAIResponsesHandler({
				...normalizedConfig,
				routingProviderId,
				baseUrl: "https://api.openai.com/v1",
			});
}

export async function createHandlerAsync(
	config: ProviderConfig,
): Promise<ApiHandler> {
	const normalizedConfig = withNormalizedProviderId(config);
	const { providerId } = normalizedConfig;
	const routingProviderId = resolveRoutingProviderId(normalizedConfig);

	if (hasRegisteredHandler(providerId)) {
		const handler = await getRegisteredHandlerAsync(
			providerId,
			normalizedConfig,
		);
		if (handler) {
			return handler;
		}
	}

	if (isOpenAICompatibleProvider(routingProviderId)) {
		const providerDefaults = await resolveProviderConfig(
			routingProviderId,
			normalizedConfig.modelCatalog,
			{ ...normalizedConfig, routingProviderId },
		);
		if (providerDefaults) {
			const mergedConfig = mergeProviderDefaults(
				{ ...normalizedConfig, routingProviderId },
				providerDefaults,
			);
			return (
				createBuiltInHandler(mergedConfig) ??
				new OpenAICompatibleHandler(mergedConfig)
			);
		}
	}

	return createHandler(normalizedConfig);
}

export const BUILT_IN_PROVIDERS: ProviderId[] = [
	...new Set<ProviderId>(
		MODEL_COLLECTION_LIST.map(
			(collection) => collection.provider.id as ProviderId,
		),
	),
];

const BUILT_IN_PROVIDER_SET = new Set<string>(BUILT_IN_PROVIDERS);

export function isProviderSupported(providerId: string): boolean {
	const normalizedProviderId = normalizeProviderId(providerId);
	return (
		BUILT_IN_PROVIDER_SET.has(normalizedProviderId) ||
		hasRegisteredHandler(normalizedProviderId) ||
		hasRegisteredHandler(providerId)
	);
}
