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

export type ProviderApiLine = "china" | "international";

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
	/**
	 * Regional endpoint routing facts: base URL per API line. Used when the
	 * caller selects an `apiLine` without an explicit base URL. The line that
	 * matches `defaults.baseUrl` is included so the mapping is exhaustive and
	 * self-documenting.
	 */
	apiLineBaseUrls?: Readonly<Partial<Record<ProviderApiLine, string>>>;
	configFields?: readonly ProviderConfigField[];
	metadata?: GatewayProviderMetadata;
}
