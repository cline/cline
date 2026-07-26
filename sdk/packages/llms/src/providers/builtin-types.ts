import type {
	GatewayProviderMetadata,
	GatewayProviderSettings,
	ProviderCapability,
} from "@cline/shared";
import type { ModelInfo } from "../catalog/types";

export type ProviderFamily = "bedrock";

export interface BuiltinSpec {
	id: "bedrock";
	name: string;
	description: string;
	family: ProviderFamily;
	capabilities?: ProviderCapability[];
	modelsProviderId: "bedrock";
	defaultModelId: string;
	modelsFactory: () => Record<string, ModelInfo>;
	env: readonly ["node"];
	defaults?: GatewayProviderSettings;
	metadata?: GatewayProviderMetadata;
}
