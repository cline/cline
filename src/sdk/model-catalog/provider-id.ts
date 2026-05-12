// Phase 0 stub. Behavior added in Phase 1.

import type { KnownProviderId, ProviderId } from "./contracts"

/**
 * Parse a raw string into a branded {@link ProviderId}.
 *
 * Phase 0 stub: trim + lowercase, then brand. The single `as ProviderId`
 * cast here is the constructor for the brand and is the allowed boundary
 * cast for this primitive. Do not replicate this cast elsewhere; callers
 * outside this module must obtain a `ProviderId` through this function.
 */
export function parseProviderId(raw: string): ProviderId {
	const normalized = raw.trim().toLowerCase()
	return normalized as ProviderId
}

/**
 * Type guard narrowing a {@link ProviderId} to {@link KnownProviderId}.
 *
 * Phase 0 stub: returns `true` so the type narrows. Real recognition of
 * the `ApiProvider` set lands in a later phase.
 */
export function isKnownProviderId(id: ProviderId): id is KnownProviderId {
	void id
	return true
}
