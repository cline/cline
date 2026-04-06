export {
	getProviderConfig,
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
import { AnthropicHandler } from "./families/anthropic";
import { AskSageHandler } from "./families/asksage";
import { BedrockHandler } from "./families/bedrock";
import {
	ClaudeCodeHandler,
	CodexHandler,
	DifyHandler,
	MistralHandler,
	OpenCodeHandler,
	SapAiCoreHandler,
} from "./families/community";
import { GeminiHandler } from "./families/gemini";
import { OpenAIBaseHandler } from "./families/openai-chat";
import { OpenAICompatibleHandler } from "./families/openai-compatible";
import { OpenAIResponsesHandler } from "./families/openai-responses";
import { VertexHandler } from "./families/vertex";
import {
	type BuiltInProviderFamily,
	getBuiltInProviderManifest,
} from "./runtime/builtin-manifests";
import {
	getProviderConfig,
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
const FAMILY_HANDLER_FACTORIES: Record<
	BuiltInProviderFamily,
	InternalHandlerFactory
> = {
	anthropic: (config) => new AnthropicHandler(config),
	gemini: (config) => new GeminiHandler(config),
	vertex: (config) => new VertexHandler(config),
	bedrock: (config) => new BedrockHandler(config),
	"openai-responses": (config) => new OpenAIResponsesHandler(config),
	"openai-base": (config) => new OpenAIBaseHandler(config),
	"openai-compatible": (config) => new OpenAICompatibleHandler(config),
	asksage: (config) => new AskSageHandler(config),
	"claude-code": (config) => new ClaudeCodeHandler(config),
	"openai-codex": (config) => new CodexHandler(config),
	opencode: (config) => new OpenCodeHandler(config),
	mistral: (config) => new MistralHandler(config),
	dify: (config) => new DifyHandler(config),
	sapaicore: (config) => new SapAiCoreHandler(config),
	oca: (config) => createOcaHandler(config),
};

function createBuiltInHandler(config: ProviderConfig): ApiHandler | undefined {
	const routingProviderId = resolveRoutingProviderId(config);
	const manifest = getBuiltInProviderManifest(routingProviderId);
	if (!manifest) {
		return undefined;
	}

	return FAMILY_HANDLER_FACTORIES[manifest.family]?.(config);
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
		const providerDefaults =
			getProviderConfig(routingProviderId) ??
			OPENAI_COMPATIBLE_PROVIDERS[routingProviderId];
		const mergedConfig = mergeProviderDefaults(
			{ ...normalizedConfig, routingProviderId },
			providerDefaults,
		);
		return (
			createBuiltInHandler(mergedConfig) ??
			new OpenAICompatibleHandler(mergedConfig)
		);
	}

	const fallbackFamily = normalizedConfig.baseUrl
		? "openai-compatible"
		: "openai-responses";
	return FAMILY_HANDLER_FACTORIES[fallbackFamily]({
		...normalizedConfig,
		routingProviderId,
		baseUrl: normalizedConfig.baseUrl ?? "https://api.openai.com/v1",
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
