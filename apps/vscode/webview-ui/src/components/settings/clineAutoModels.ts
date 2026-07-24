import type { ModelInfo } from "@shared/api"

export const CLINE_AUTO_MODEL_ID = "cline/auto"
export const CLINE_PASS_AUTO_MODEL_ID = "cline-pass/auto"

const CLINE_AUTO_MODEL_INFO: ModelInfo = {
	name: "Cline Auto",
	supportsImages: true,
	supportsPromptCache: true,
	description:
		"Automatically routes each turn to an eligible Cline model while accounting for prompt-cache reuse and switching cost.",
}

const CLINE_PASS_AUTO_MODEL_INFO: ModelInfo = {
	name: "Cline Pass Auto",
	supportsImages: true,
	supportsPromptCache: true,
	inputPrice: 0,
	outputPrice: 0,
	cacheReadsPrice: 0,
	cacheWritesPrice: 0,
	description:
		"Automatically routes each turn using only Cline Pass models while accounting for prompt-cache reuse and switching cost.",
}

interface ClineAutoModelOptions {
	enabled: boolean
	isClinePassAutoModelEnabled: boolean
}

export function shouldNormalizeClineAutoModel(modelId: string | undefined, options: ClineAutoModelOptions): boolean {
	if (modelId === CLINE_AUTO_MODEL_ID) {
		return !options.enabled
	}
	if (modelId === CLINE_PASS_AUTO_MODEL_ID) {
		return !options.enabled || !options.isClinePassAutoModelEnabled
	}
	return false
}

/**
 * Adds the feature-gated virtual router entries to the Cline provider catalog.
 *
 * Keep this as a view over the live SDK catalog: the virtual entries are not
 * real SDK models, and the backend must resolve them before normal model
 * lookup. If the endpoint eventually returns either entry, its live metadata
 * wins over the local fallback.
 */
export function withClineAutoModels(
	models: Record<string, ModelInfo> | undefined,
	options: ClineAutoModelOptions,
): Record<string, ModelInfo> {
	const effectiveModels = { ...models }
	const liveClineAutoModel = effectiveModels[CLINE_AUTO_MODEL_ID]
	const liveClinePassAutoModel = effectiveModels[CLINE_PASS_AUTO_MODEL_ID]

	// The endpoint may learn these IDs before the rollout is complete. Remove
	// them first so visibility still follows the client-side rollout gates.
	delete effectiveModels[CLINE_AUTO_MODEL_ID]
	delete effectiveModels[CLINE_PASS_AUTO_MODEL_ID]

	if (!options.enabled) {
		return effectiveModels
	}

	effectiveModels[CLINE_AUTO_MODEL_ID] = liveClineAutoModel ?? CLINE_AUTO_MODEL_INFO
	if (options.isClinePassAutoModelEnabled) {
		effectiveModels[CLINE_PASS_AUTO_MODEL_ID] = liveClinePassAutoModel ?? CLINE_PASS_AUTO_MODEL_INFO
	}

	return effectiveModels
}
