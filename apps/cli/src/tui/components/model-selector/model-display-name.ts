export function resolveKnownModelInfo(
	modelId: string,
	knownModels?: Record<string, unknown>,
): { name?: string } | undefined {
	if (!knownModels) return undefined;

	const exactMatch = knownModels[modelId] as { name?: string } | undefined;
	if (exactMatch) return exactMatch;

	const modelSlug = modelId.split("/").pop();
	return Object.entries(knownModels).find(([key, model]) => {
		const knownModel = model as { id?: string } | undefined;
		return (
			key.split("/").pop() === modelSlug ||
			knownModel?.id?.split("/").pop() === modelSlug
		);
	})?.[1] as { name?: string } | undefined;
}

export function resolveModelDisplayName(
	modelId: string,
	knownModels?: Record<string, unknown>,
	fallbackName?: string,
): string {
	const modelInfo = resolveKnownModelInfo(modelId, knownModels);
	if (modelInfo?.name) return modelInfo.name;

	if (fallbackName) return fallbackName;
	return modelId.includes("/")
		? (modelId.split("/").pop() ?? modelId)
		: modelId;
}
