import {
	BEDROCK_DEFAULT_MODEL_ID,
	BEDROCK_MODELS,
	type ModelInfo,
	type ProviderConfig,
} from "@cline/llms";

export interface ProviderDefaults {
	modelId: string;
	knownModels: Record<string, ModelInfo>;
	capabilities: readonly ["reasoning", "prompt-cache", "streaming", "tools"];
}

export const DEFAULT_MODELS_CATALOG_URL = "";
export const OPENAI_COMPATIBLE_PROVIDERS = {};

const BEDROCK_DEFAULTS: ProviderDefaults = {
	modelId: BEDROCK_DEFAULT_MODEL_ID,
	knownModels: BEDROCK_MODELS,
	capabilities: ["reasoning", "prompt-cache", "streaming", "tools"],
};

export function getProviderConfig(
	providerId: string,
): ProviderDefaults | undefined {
	return providerId === "bedrock" ? BEDROCK_DEFAULTS : undefined;
}

export async function resolveProviderConfig(
	providerId: string,
	_modelCatalog?: unknown,
	_config?: ProviderConfig,
): Promise<ProviderDefaults | undefined> {
	return getProviderConfig(providerId);
}

export async function getLiveModelsCatalog(): Promise<
	Record<"bedrock", Record<string, ModelInfo>>
> {
	return { bedrock: BEDROCK_MODELS };
}

export function clearLiveModelsCatalogCache(): void {}
export function clearPrivateModelsCatalogCache(): void {}
export function clearPublicModelsCatalogCache(): void {}
