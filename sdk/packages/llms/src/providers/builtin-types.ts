import type {
	GatewayProviderMetadata,
	GatewayProviderSettings,
	ProviderCapability,
	ProviderConfigField,
} from "@cline/shared";
import type {
	ModelInfo,
	ProviderClient,
	ProviderProtocol,
} from "../catalog/types";

export type ProviderFamily =
	| "openai"
	| "openai-compatible"
	| "anthropic"
	| "google"
	| "vertex"
	| "bedrock"
	| "mistral"
	| "claude-code"
	| "openai-codex"
	| "opencode"
	| "dify"
	| "ollama"
	| "sap-ai-core";

export interface BuiltinSpec {
	id: string;
	name: string;
	description: string;
	family: ProviderFamily;
	protocol?: ProviderProtocol;
	client?: ProviderClient;
	capabilities?: ProviderCapability[];
	popular?: number;
	modelsProviderId?: string;
	defaultModelId?: string;
	modelsFactory?: () => Record<string, ModelInfo>;
	env?: readonly ("browser" | "node")[];
	apiKeyEnv?: readonly string[];
	modelsSourceUrl?: string;
	docsUrl?: string;
	defaults?: GatewayProviderSettings;
	configFields?: readonly ProviderConfigField[];
	metadata?: GatewayProviderMetadata;
}
