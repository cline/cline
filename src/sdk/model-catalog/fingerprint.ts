// Phase 0 stub. Behavior added in Phase 1.

import type { EffectiveProviderConfig, Fingerprint, ProviderId } from "./contracts"

/**
 * Compute a fingerprint for the given provider effective config.
 *
 * Invariant: total, pure, deterministic. Same `(providerId, config)` always
 * produces the same fingerprint; different inputs produce different
 * fingerprints (up to hash collision). Raw secrets never appear in the
 * output.
 *
 * Phase 0 stub: returns a placeholder string branded as a `Fingerprint`.
 * The `as Fingerprint` cast here is the allowed boundary cast for this
 * primitive; the brand has no constructor other than this function.
 */
export function computeConfigFingerprint(providerId: ProviderId, _config: EffectiveProviderConfig): Fingerprint {
	return `phase-0-placeholder:${providerId}` as Fingerprint
}
