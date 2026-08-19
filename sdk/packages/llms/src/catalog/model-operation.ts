import type { ModelOperation, ModelOperationMode } from "./types";

interface CatalogOperationDescriptor {
	operation?: ModelOperation;
	family?: string;
	modalities?: {
		input?: readonly string[];
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
	const input = model.modalities?.input;
	const output = model.modalities?.output;
	if (
		input?.length === 1 &&
		input[0] === "audio" &&
		output?.length === 1 &&
		output[0] === "text"
	) {
		return "transcription";
	}
	if (
		output?.includes("image") === true &&
		(output.includes("text") !== true ||
			model.family?.trim().toLowerCase() === "gpt-image")
	) {
		return "image-generation";
	}
	if (output?.includes("audio") === true && output.includes("text") !== true) {
		return "speech-generation";
	}
	if (output?.includes("video") === true && output.includes("text") !== true) {
		return "video-generation";
	}
	return "language";
}

/**
 * Normalize operation-specific execution modes at the catalog boundary.
 * models.dev does not currently expose a batch/streaming field, so realtime
 * transcription identifiers are recognized here once and persisted as an
 * explicit fact for every runtime and client.
 */
export function resolveCatalogModelOperationModes(
	modelId: string,
	model: CatalogOperationDescriptor & { name?: string },
): ModelOperationMode[] | undefined {
	if (resolveCatalogModelOperation(model) !== "transcription") {
		return undefined;
	}
	const identity = `${modelId} ${model.name ?? ""}`.toLowerCase();
	return [
		/(?:^|[/_.-])realtime(?:$|[/_.-])/.test(identity) ? "streaming" : "batch",
	];
}
