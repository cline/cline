/**
 * Types Index
 *
 * Re-exports all types from the types module.
 */

// Message types (canonical home: @clinebot/shared)
export type {
	ContentBlock,
	FileContent,
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
} from "@clinebot/shared";
// Configuration types
export {
	type AuthConfig,
	type AwsConfig,
	type AzureConfig,
	BUILT_IN_PROVIDER,
	BUILT_IN_PROVIDER_IDS,
	type BuiltInProviderId,
	type ClaudeCodeConfig,
	type CloudConfig,
	type CodexConfig,
	createConfig,
	type EndpointConfig,
	type GcpConfig,
	hasCapability,
	isBuiltInProviderId,
	type ModelCatalogConfig,
	type ModelConfig,
	normalizeProviderId,
	type OcaConfig,
	type OpenCodeConfig,
	type ProviderCapability,
	type ProviderCategory,
	type ProviderConfig,
	type ProviderDefaultsConfig,
	type ProviderId,
	type ProviderOptions,
	type ProviderSpecificConfig,
	type ReasoningConfig,
	type RegionConfig,
	resolveRoutingProviderId,
	type SapConfig,
	type SimpleProviderConfig,
	supportsPromptCache,
	supportsReasoning,
	type TokenConfig,
} from "../config/provider-config";
// Settings types and functions (Zod-based validation)
export {
	type AuthSettings,
	AuthSettingsSchema,
	type AwsSettings,
	AwsSettingsSchema,
	type AzureSettings,
	AzureSettingsSchema,
	createProviderConfig,
	type GcpSettings,
	GcpSettingsSchema,
	type ModelCatalogSettings,
	ModelCatalogSettingsSchema,
	type OcaSettings,
	OcaSettingsSchema,
	// Schemas
	ProviderIdSchema,
	// Types
	type ProviderSettings,
	ProviderSettingsSchema,
	// Functions
	parseSettings,
	type ReasoningSettings,
	ReasoningSettingsSchema,
	type SapSettings,
	SapSettingsSchema,
	safeCreateProviderConfig,
	safeParseSettings,
	toProviderConfig,
} from "../config/provider-settings";
// Handler types
export type {
	ApiHandler,
	HandlerFactory,
	HandlerModelInfo,
	LazyHandlerFactory,
	SingleCompletionHandler,
} from "./handler";
// Model information types
export {
	ApiFormat,
	getModelPricing,
	hasModelCapability,
	type ModelCapability,
	type ModelInfo,
	type ModelPricing,
	type ModelWithId,
	type OpenAICompatibleModelInfo,
	supportsModelThinking,
	type ThinkingConfig,
} from "./model-info";
// Stream types
export type {
	ApiStream,
	ApiStreamChunk,
	ApiStreamDoneChunk,
	ApiStreamReasoningChunk,
	ApiStreamTextChunk,
	ApiStreamToolCall,
	ApiStreamToolCallsChunk,
	ApiStreamUsageChunk,
} from "./stream";
