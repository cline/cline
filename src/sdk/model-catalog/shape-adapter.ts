// Phase 0 stub. Behavior added in Phase 2.

import { type ModelInfo, openAiModelInfoSafeDefaults } from "@shared/api"

/**
 * Adapt an SDK model-info shape into the extension's {@link ModelInfo} shape.
 *
 * Real implementation validates SDK responses at the boundary; malformed
 * responses produce a `CatalogError` upstream, not malformed downstream
 * data.
 *
 * Phase 0 stub: returns a copy of {@link openAiModelInfoSafeDefaults}
 * (imported directly from `@shared.api`) for
 * every input.
 */
export function adaptSdkModelInfo(_input: unknown): ModelInfo {
	return { ...openAiModelInfoSafeDefaults }
}
