import type { ModelInfo } from "@shared/api"
import { ModelOverrides } from "@shared/proto/cline/models"

/**
 * Domain shape of user-authored per-model metadata overrides, shared by the
 * webview (commit path) and the host (read/commit handlers). Mirrors the
 * `ModelOverrides` proto message.
 *
 * Semantics (enforced host-side in the provider config store):
 *  - `capabilities` accepts only SDK `ModelCapability` values; unknown
 *    strings are silently dropped. The array is additive over the base
 *    metadata; the explicit `supports*` booleans win when both are present.
 *  - `isR1FormatRequired` is a legacy alias that forces the R1 chat format
 *    only when true; `apiFormat` is canonical.
 *  - Invalid numbers (non-positive token limits, negative prices or
 *    temperature, non-finite values) are silently discarded, not rejected.
 *
 * When committing a selection, the overrides value is tri-state: `undefined`
 * preserves the model's stored overrides, an explicitly empty object clears
 * them, and a non-empty object replaces them wholesale (no per-field merge).
 */
export interface ProviderModelOverrides {
	name?: string
	maxTokens?: number
	contextWindow?: number
	maxInputTokens?: number
	capabilities?: readonly string[]
	supportsVision?: boolean
	supportsAttachments?: boolean
	supportsReasoning?: boolean
	inputPrice?: number
	outputPrice?: number
	cacheReadsPrice?: number
	cacheWritesPrice?: number
	temperature?: number
	apiFormat?: ModelInfo["apiFormat"]
	isR1FormatRequired?: boolean
}

export function toProtobufModelOverrides(overrides: ProviderModelOverrides): ModelOverrides {
	return ModelOverrides.create({
		name: overrides.name,
		maxTokens: overrides.maxTokens,
		contextWindow: overrides.contextWindow,
		maxInputTokens: overrides.maxInputTokens,
		capabilities: overrides.capabilities ? [...overrides.capabilities] : [],
		supportsVision: overrides.supportsVision,
		supportsAttachments: overrides.supportsAttachments,
		supportsReasoning: overrides.supportsReasoning,
		inputPrice: overrides.inputPrice,
		outputPrice: overrides.outputPrice,
		cacheReadsPrice: overrides.cacheReadsPrice,
		cacheWritesPrice: overrides.cacheWritesPrice,
		temperature: overrides.temperature,
		apiFormat: overrides.apiFormat,
		isR1FormatRequired: overrides.isR1FormatRequired,
	})
}

/**
 * Preserves the proto tri-state: `undefined` stays `undefined` (no override
 * payload), and an empty message becomes an empty object (explicit clear).
 */
export function fromProtobufModelOverrides(overrides: ModelOverrides | undefined): ProviderModelOverrides | undefined {
	if (!overrides) {
		return undefined
	}
	return {
		...(overrides.name !== undefined ? { name: overrides.name } : {}),
		...(overrides.maxTokens !== undefined ? { maxTokens: overrides.maxTokens } : {}),
		...(overrides.contextWindow !== undefined ? { contextWindow: overrides.contextWindow } : {}),
		...(overrides.maxInputTokens !== undefined ? { maxInputTokens: overrides.maxInputTokens } : {}),
		...(overrides.capabilities.length > 0 ? { capabilities: [...overrides.capabilities] } : {}),
		...(overrides.supportsVision !== undefined ? { supportsVision: overrides.supportsVision } : {}),
		...(overrides.supportsAttachments !== undefined ? { supportsAttachments: overrides.supportsAttachments } : {}),
		...(overrides.supportsReasoning !== undefined ? { supportsReasoning: overrides.supportsReasoning } : {}),
		...(overrides.inputPrice !== undefined ? { inputPrice: overrides.inputPrice } : {}),
		...(overrides.outputPrice !== undefined ? { outputPrice: overrides.outputPrice } : {}),
		...(overrides.cacheReadsPrice !== undefined ? { cacheReadsPrice: overrides.cacheReadsPrice } : {}),
		...(overrides.cacheWritesPrice !== undefined ? { cacheWritesPrice: overrides.cacheWritesPrice } : {}),
		...(overrides.temperature !== undefined ? { temperature: overrides.temperature } : {}),
		...(overrides.apiFormat !== undefined ? { apiFormat: overrides.apiFormat } : {}),
		...(overrides.isR1FormatRequired !== undefined ? { isR1FormatRequired: overrides.isR1FormatRequired } : {}),
	}
}
