export {
	createBedrockAgentModel,
	createBedrockClient,
} from "./providers/compat";
export type {
	ApiHandler,
	ApiStreamChunk,
	BedrockConnection,
	BuiltInProviderId,
	ContentBlock,
	FileContent,
	HandlerModelInfo,
	ImageContent,
	Message,
	MessageRole,
	MessageWithMetadata,
	ProviderCapability,
	ProviderConfig,
	ProviderId,
	RedactedThinkingContent,
	TextContent,
	ThinkingContent,
	ToolDefinition,
	ToolResultContent,
	ToolUseContent,
} from "./providers/types";
export {
	BUILT_IN_PROVIDER,
	BUILT_IN_PROVIDER_IDS,
	isBuiltInProviderId,
	normalizeProviderId,
} from "./providers/types";

import {
	createBedrockClient,
} from "./providers/compat";
import type { ApiHandler, ProviderConfig } from "./providers/types";

export function createHandler(config: ProviderConfig): ApiHandler {
	return createBedrockClient(config);
}

export async function createHandlerAsync(
	config: ProviderConfig,
): Promise<ApiHandler> {
	return createBedrockClient(config);
}
