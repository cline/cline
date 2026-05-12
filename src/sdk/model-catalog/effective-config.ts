// Phase 0 stub. Behavior added in Phase 1.

import type { EffectiveProviderConfig, ProviderId } from "./contracts"

/**
 * Build an {@link EffectiveProviderConfig} by merging all config sources
 * (providers.json, StateManager, remote config overlays, defaults).
 *
 * Phase 0 stub: returns a minimal object carrying only the `providerId`.
 */
export function buildEffectiveProviderConfig(providerId: ProviderId): EffectiveProviderConfig {
	return { providerId }
}
