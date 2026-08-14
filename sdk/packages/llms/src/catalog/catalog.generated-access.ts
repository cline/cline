import {
	builtinProviderSupportsModelOperation,
	normalizeBuiltinModelOperationModalities,
} from "../providers/model-operations";
import { GENERATED_PROVIDER_MODELS } from "./catalog.generated";
import { sortModelsByReleaseDate } from "./catalog-live";
import {
	resolveCatalogModelOperation,
	resolveCatalogModelOperationModes,
} from "./model-operation";
import type { ModelInfo } from "./types";

let sortedGeneratedProviderModelsCache:
	| Record<string, Record<string, ModelInfo>>
	| undefined;
const sortedGeneratedModelsByProviderCache = new Map<
	string,
	Record<string, ModelInfo>
>();

function normalizeGeneratedModels(
	providerId: string,
	models: Record<string, ModelInfo>,
): Record<string, ModelInfo> {
	return Object.fromEntries(
		Object.entries(models).flatMap(([modelId, model]) => {
			const operation = resolveCatalogModelOperation(model);
			const operationModes =
				model.operationModes ??
				resolveCatalogModelOperationModes(modelId, model);
			const modalities = normalizeBuiltinModelOperationModalities({
				providerId,
				modelId,
				operation,
				operationModes,
				modalities: model.modalities,
				family: model.family,
				capabilities: model.capabilities,
			});
			const normalized = {
				...model,
				operation,
				...(operationModes ? { operationModes } : {}),
				...(modalities ? { modalities } : {}),
			};
			return builtinProviderSupportsModelOperation({
				providerId,
				modelId,
				operation: normalized.operation,
				operationModes: normalized.operationModes,
				modalities: normalized.modalities,
				family: normalized.family,
				capabilities: normalized.capabilities,
			})
				? [[modelId, normalized] as const]
				: [];
		}),
	);
}

export function getGeneratedProviderModels(): Record<
	string,
	Record<string, ModelInfo>
> {
	sortedGeneratedProviderModelsCache ??= Object.fromEntries(
		Object.entries(GENERATED_PROVIDER_MODELS.providers).map(
			([providerId, models]) => [
				providerId,
				sortModelsByReleaseDate(normalizeGeneratedModels(providerId, models)),
			],
		),
	);
	return sortedGeneratedProviderModelsCache;
}

export function getGeneratedModelsVersion(): number {
	return GENERATED_PROVIDER_MODELS.version;
}

export function getGeneratedModelsForProvider(
	providerId: string,
): Record<string, ModelInfo> {
	const cached = sortedGeneratedModelsByProviderCache.get(providerId);
	if (cached) {
		return cached;
	}
	const sorted = sortModelsByReleaseDate(
		normalizeGeneratedModels(
			providerId,
			GENERATED_PROVIDER_MODELS.providers[providerId] ?? {},
		),
	);
	sortedGeneratedModelsByProviderCache.set(providerId, sorted);
	return sorted;
}
