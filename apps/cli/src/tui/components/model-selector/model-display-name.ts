export interface KnownModelInfo {
	id?: string;
	name?: string;
	capabilities?: string[];
	maxInputTokens?: number;
	contextWindow?: number;
}

export type KnownModels = Record<string, KnownModelInfo>;

export function resolveKnownModelInfo(
	modelId: string,
	knownModels?: KnownModels,
): KnownModelInfo | undefined {
	if (!knownModels) return undefined;

	const exactMatch = knownModels[modelId];
	if (exactMatch !== undefined) return exactMatch;

	const modelSlug = modelId.split("/").pop();
	return Object.entries(knownModels).find(([key, model]) => {
		return (
			key.split("/").pop() === modelSlug ||
			model.id?.split("/").pop() === modelSlug
		);
	})?.[1];
}

export function resolveModelDisplayName(
	modelId: string,
	knownModels?: KnownModels,
	fallbackName?: string,
): string {
	const modelInfo = resolveKnownModelInfo(modelId, knownModels);
	if (modelInfo?.name) return modelInfo.name;

	if (fallbackName) return fallbackName;
	return modelId.includes("/")
		? (modelId.split("/").pop() ?? modelId)
		: modelId;
}
