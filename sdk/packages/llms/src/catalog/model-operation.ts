import type { ModelOperation } from "./types";

interface CatalogOperationDescriptor {
	operation?: ModelOperation;
	family?: string;
	modalities?: {
		output?: readonly string[];
	};
}

/**
 * Classify the provider operation while ingesting external catalog facts.
 * This is deliberately a catalog-boundary normalization; runtime routing reads
 * the resulting explicit `operation` and never infers an endpoint from a
 * provider family or modality.
 */
export function resolveCatalogModelOperation(
	model: CatalogOperationDescriptor,
): ModelOperation {
	if (model.operation) {
		return model.operation;
	}
	const output = model.modalities?.output;
	if (
		output?.includes("image") === true &&
		(output.includes("text") !== true ||
			model.family?.trim().toLowerCase() === "gpt-image")
	) {
		return "image-generation";
	}
	return "language";
}
