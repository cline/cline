/**
 * Model Information Types
 *
 * Re-exports model types from @clinebot/models (the single source of truth)
 * and provides provider-specific helpers and aliases.
 */

import type {
	ModelCapability,
	ModelInfo,
	ModelPricing,
	ThinkingConfig,
} from "../../models/types/model";
import { ApiFormat } from "../../models/types/model";

export type { ModelCapability, ModelInfo, ModelPricing, ThinkingConfig };
export { ApiFormat };
export type { ApiFormat as ApiFormatType } from "../../models/types/model";

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Check if a model has a specific capability
 */
export function hasModelCapability(
	info: ModelInfo,
	capability: ModelCapability,
): boolean {
	return info.capabilities?.includes(capability) ?? false;
}

/**
 * Check if a model supports explicit thinking/reasoning controls.
 */
export function supportsModelThinking(info: ModelInfo): boolean {
	return Boolean(info.thinkingConfig) || hasModelCapability(info, "reasoning");
}

/**
 * Get pricing for a model
 */
export function getModelPricing(info: ModelInfo): ModelPricing {
	return info.pricing ?? {};
}

// =============================================================================
// Model with ID
// =============================================================================

/**
 * Model with its identifier
 */
export interface ModelWithId {
	id: string;
	info: ModelInfo;
}

// =============================================================================
// Type Aliases (for backwards compatibility)
// =============================================================================

/** Alias for ModelInfo - all model types use the same interface */
export type OpenAICompatibleModelInfo = ModelInfo;
