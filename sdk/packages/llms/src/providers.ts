export {
	type ApiHandler,
	BUILT_IN_PROVIDER,
	BUILT_IN_PROVIDER_IDS,
	type BuiltInProviderId,
	type HandlerFactory,
	isBuiltInProviderId,
	type LazyHandlerFactory,
	normalizeProviderId,
	type ProviderCapability,
	type ProviderConfig,
	type ProviderId,
} from "./providers/types";

import {
	createGatewayApiHandler,
	createGatewayApiHandlerAsync,
} from "./providers/compat";
import {
	getRegisteredHandler,
	getRegisteredHandlerAsync,
	hasRegisteredHandler,
	isRegisteredHandlerAsync,
} from "./providers/factory-registry";
import {
	type ApiHandler,
	normalizeProviderId,
	type ProviderConfig,
} from "./providers/types";

export {
	registerAsyncHandler,
	registerHandler,
} from "./providers/factory-registry";
export type {
	ApiStreamChunk,
	ContentBlock,
	FileContent,
	HandlerModelInfo,
	ImageContent,
	Message,
	MessageRole,
	MessageWithMetadata,
	RedactedThinkingContent,
	TextContent,
	ThinkingContent,
	ToolDefinition,
	ToolResultContent,
	ToolUseContent,
} from "./providers/types";

function withNormalizedProviderId(config: ProviderConfig): ProviderConfig {
	const providerId = normalizeProviderId(config.providerId);
	const routingProviderId = config.routingProviderId
		? normalizeProviderId(config.routingProviderId)
		: undefined;
	if (
		providerId === config.providerId &&
		routingProviderId === config.routingProviderId
	) {
		return config;
	}
	return { ...config, providerId, routingProviderId };
}

export function createHandler(config: ProviderConfig): ApiHandler {
	const normalizedConfig = withNormalizedProviderId(config);
	const { providerId } = normalizedConfig;

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

	return createGatewayApiHandler(normalizedConfig);
}

export async function createHandlerAsync(
	config: ProviderConfig,
): Promise<ApiHandler> {
	const normalizedConfig = withNormalizedProviderId(config);
	const { providerId } = normalizedConfig;

	if (hasRegisteredHandler(providerId)) {
		const handler = await getRegisteredHandlerAsync(
			providerId,
			normalizedConfig,
		);
		if (handler) {
			return handler;
		}
	}

	return createGatewayApiHandlerAsync(normalizedConfig);
}
