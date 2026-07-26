import { BEDROCK_MODEL_COLLECTION } from "../catalog/bedrock";
import type {
	ModelCollection,
	ModelInfo,
	ProviderInfo,
} from "../catalog/types";

function cloneCollection(): ModelCollection {
	return {
		provider: { ...BEDROCK_MODEL_COLLECTION.provider },
		models: Object.fromEntries(
			Object.entries(BEDROCK_MODEL_COLLECTION.models).map(([id, model]) => [
				id,
				{ ...model },
			]),
		),
	};
}

const collection = cloneCollection();

export const MODEL_COLLECTIONS_BY_PROVIDER_ID: Record<
	"bedrock",
	ModelCollection
> = {
	bedrock: collection,
};

export function getProviderIds(): ["bedrock"] {
	return ["bedrock"];
}

export function hasProvider(providerId: string): boolean {
	return providerId === "bedrock";
}

export async function getProvider(
	providerId: string,
): Promise<ProviderInfo | undefined> {
	return providerId === "bedrock" ? collection.provider : undefined;
}

export function getProviderCollectionSync(
	providerId: string,
): ModelCollection | undefined {
	return providerId === "bedrock" ? collection : undefined;
}

export async function getProviderCollection(
	providerId: string,
): Promise<ModelCollection | undefined> {
	return getProviderCollectionSync(providerId);
}

export async function getModelsForProvider(
	providerId: string,
): Promise<Record<string, ModelInfo>> {
	return providerId === "bedrock" ? collection.models : {};
}

export async function getAllProviders(): Promise<ProviderInfo[]> {
	return [collection.provider];
}
