import type { ModelInfo, ProviderCapability } from "@bedrock-coder/shared";

export {
	type ModelCapability,
	ModelCapabilitySchema,
	type ModelInfo,
	ModelInfoSchema,
	type ModelMetadata,
	ModelMetadataSchema,
	type ModelPricing,
	ModelPricingSchema,
	type ModelStatus,
	ModelStatusSchema,
	type ThinkingConfig,
	ThinkingConfigSchema,
} from "@bedrock-coder/shared";

export type { ProviderCapability };

export type ProviderClient = "bedrock";
export type ProviderProtocol = "ai-sdk";
export type ProviderSource = "system";

export interface ProviderInfo {
	id: "bedrock";
	name: string;
	description?: string;
	protocol?: ProviderProtocol;
	defaultModelId: string;
	capabilities?: ProviderCapability[];
	client: ProviderClient;
	source: ProviderSource;
	metadata?: Record<string, unknown>;
}

export interface ModelCollection {
	provider: ProviderInfo;
	models: Record<string, ModelInfo>;
}
