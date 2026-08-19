import type { ModelInfo } from "./types";

/**
 * Remove models that declare image output from a model catalog.
 *
 * This includes both dedicated image-generation models and language models
 * that can return mixed text-and-image output.
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
