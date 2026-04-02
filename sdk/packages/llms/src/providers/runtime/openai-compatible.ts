import * as modelProviderExports from "../../models/catalog/providers/index";
import type {
	ModelCollection,
	ModelInfo,
	ProviderCapability,
	ProviderProtocol,
} from "../../models/types/index";
import type { ProviderClient } from "../../models/types/model";

export interface OpenAICompatibleProviderDefaults {
	baseUrl: string;
	modelId: string;
	knownModels?: Record<string, ModelInfo>;
	capabilities?: ProviderCapability[];
}

function isModelCollection(value: unknown): value is ModelCollection {
	if (!value || typeof value !== "object") {
		return false;
	}

	const maybeCollection = value as Partial<ModelCollection>;
	return (
		typeof maybeCollection.provider === "object" &&
		typeof maybeCollection.models === "object"
	);
}

function isOpenAICompatibleProtocol(
	protocol: ProviderProtocol | undefined,
	client: ProviderClient,
): boolean {
	return (
		client === "openai-compatible" ||
		protocol === "openai-chat" ||
		protocol === "openai-responses" ||
		protocol === "openai-r1"
	);
}

export function buildOpenAICompatibleProviderDefaults(options?: {
	includeKnownModels?: boolean;
}): Record<string, OpenAICompatibleProviderDefaults> {
	const defaults: Record<string, OpenAICompatibleProviderDefaults> = {};
	const includeKnownModels = options?.includeKnownModels ?? false;

	for (const value of Object.values(modelProviderExports)) {
		if (!isModelCollection(value)) {
			continue;
		}

		const provider = value.provider;
		if (
			!isOpenAICompatibleProtocol(provider.protocol, provider.client) ||
			!provider.baseUrl
		) {
			continue;
		}

		defaults[provider.id] = {
			baseUrl: provider.baseUrl,
			modelId: provider.defaultModelId,
			knownModels: includeKnownModels ? value.models : undefined,
			capabilities: provider.capabilities,
		};
	}

	return defaults;
}

/**
 * Build a map of provider ID → ProviderClient from all catalog entries.
 * This is the single source of truth for which client/SDK a provider uses.
 */
export function buildProviderClientMap(): Record<string, ProviderClient> {
	const map: Record<string, ProviderClient> = {};
	for (const value of Object.values(modelProviderExports)) {
		if (!isModelCollection(value)) {
			continue;
		}
		map[value.provider.id] = value.provider.client;
	}
	return map;
}
