import type {
	GatewayModelOperationCapability,
	GatewayModelToolCapability,
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
	| "cline"
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
	modelToolCapabilities?: readonly GatewayModelToolCapability[];
	modelOperationCapabilities?: readonly GatewayModelOperationCapability[];
	capabilities?: ProviderCapability[];
	popular?: number;
	modelsProviderId?: string;
	defaultModelId?: string;
	modelsFactory?: () => Record<string, ModelInfo>;
	env?: readonly ("browser" | "node")[];
	apiKeyEnv?: readonly string[];
	/**
	 * Command probed on PATH for providers whose transport is a locally
	 * installed CLI (the `local-auth` providers). It is the CLI analogue of
	 * `defaults.baseUrl`: the vendor-defined name of the thing we run, not a
	 * resolved path, which stays a per-machine detail of the readiness probe.
	 */
	executable?: string;
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
