import type { ModelInfo } from "./types";

/**
 * Remove models that declare image output from a model catalog.
 *
 * This includes both dedicated image-generation models and language models
 * that can return mixed text-and-image output. Cline deliberately applies
 * this temporary backend limitation in both `buildClineModels` (the bundled
 * catalog) and `mergeKnownModels` (the runtime catalog, including user models).
 * Remove both call sites together when the inference backend supports image
 * output.
 */
export function filterImageOutputModels(
	models: Record<string, ModelInfo>,
): Record<string, ModelInfo> {
	return Object.fromEntries(
		Object.entries(models).filter(
			([, model]) =>
				model.operation !== "image-generation" &&
				model.modalities?.output.includes("image") !== true,
		),
	);
}
