export { resolveProviderConfig } from "./provider/defaults";
export {
	type ApiHandler,
	normalizeProviderId,
	type ProviderCapability,
	type ProviderConfig,
	type ProviderId,
} from "./provider/types";

import {
	createGatewayApiHandler,
	createGatewayApiHandlerAsync,
} from "./gateway/compat";
import {
	getRegisteredHandler,
	getRegisteredHandlerAsync,
	hasRegisteredHandler,
	isRegisteredHandlerAsync,
} from "./provider/factory-registry";
import {
	type ApiHandler,
	normalizeProviderId,
	type ProviderConfig,
} from "./provider/types";

export {
	type ApiStreamChunk,
	type ContentBlock,
	type FileContent,
	type HandlerModelInfo,
	type ImageContent,
	type Message,
	type MessageRole,
	type MessageWithMetadata,
	type ProviderSettings,
	ProviderSettingsSchema,
	parseSettings,
	type RedactedThinkingContent,
	type TextContent,
	type ThinkingContent,
	type ToolDefinition,
	type ToolResultContent,
	type ToolUseContent,
	toProviderConfig,
} from "./provider/types";

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
