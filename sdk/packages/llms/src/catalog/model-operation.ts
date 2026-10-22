import { isTranscriptionModel } from "@cline/shared";
import type { ModelOperation, ModelOperationMode } from "./types";

interface CatalogOperationDescriptor {
	id?: string;
	name?: string;
	tags?: readonly string[];
	operation?: ModelOperation;
	family?: string;
	modalities?: {
		input?: readonly string[];
		output?: readonly string[];
	};
}

// models.dev lacks realtime transport tags. Normalize its bounded identity
// markers here, only for models that accept audio; ordinary multimodal chat
// remains a language operation. Runtime consumers use the explicit operation.
function hasRealtimeIdentity(model: CatalogOperationDescriptor): boolean {
	return [model.id, model.name, model.family].some((value) =>
		/(?:^|[\s/_.-])(?:realtime|live)(?:$|[\s/_.-])/i.test(value ?? ""),
	);
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
	if (isTranscriptionModel(model)) {
		return "transcription";
	}
	if (
		model.operation === "realtime" ||
		(model.modalities?.input?.includes("audio") &&
			(model.operation === "transcription" ||
				model.tags?.includes("websocket-realtime") ||
				model.tags?.includes("websocket-transcription") ||
				hasRealtimeIdentity(model)))
	) {
		return "realtime";
	}
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
	model: CatalogOperationDescriptor,
): ModelOperationMode[] | undefined {
	const descriptor = { ...model, id: modelId };
	const operation = resolveCatalogModelOperation(descriptor);
	if (operation === "realtime") return ["streaming"];
	if (operation !== "transcription") {
		return undefined;
	}
	return [
		model.tags?.includes("websocket-transcription") ||
		hasRealtimeIdentity(descriptor)
			? "streaming"
			: "batch",
	];
}
