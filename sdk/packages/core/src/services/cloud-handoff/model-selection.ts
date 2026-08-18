export type CloudHandoffModelCatalogId = "cline" | "cline-pass" | "cline-cloud";

export type CloudHandoffModel = {
	id: string;
	name: string;
	catalogId: CloudHandoffModelCatalogId;
	description?: string;
	tags?: string[];
};

export type CloudHandoffModelSelection = {
	modelId: string;
	catalogId: CloudHandoffModelCatalogId;
	usedFallback: boolean;
};

/** Keeps the local model when cloud supports it; otherwise uses dashboard order. */
export function selectCloudHandoffModel(input: {
	localModelId?: string;
	models: readonly CloudHandoffModel[];
	isOrganizationSession?: boolean;
}): CloudHandoffModelSelection {
	const models = input.isOrganizationSession
		? input.models.filter((model) => model.catalogId !== "cline-pass")
		: input.models;
	if (models.length === 0) {
		throw new Error(
			"No cloud models are currently available for this account.",
		);
	}

	const localModelId = input.localModelId?.trim();
	const local = localModelId
		? models.find((model) => model.id === localModelId)
		: undefined;
	const selected =
		local ??
		models.find((model) => model.catalogId === "cline-cloud") ??
		models.find((model) => model.catalogId === "cline") ??
		models[0];
	if (!selected) {
		throw new Error(
			"No cloud models are currently available for this account.",
		);
	}

	return {
		modelId: selected.id,
		catalogId: selected.catalogId,
		usedFallback: selected.id !== localModelId,
	};
}
