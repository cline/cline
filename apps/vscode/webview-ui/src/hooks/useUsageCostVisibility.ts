import { useCallback } from "react"
import { useProviderListings } from "./useProviderListings"

/**
 * Returns a predicate deciding whether a history row's stored dollar cost
 * may be shown, keyed by the provider id recorded on the row
 * (`HistoryItem.apiProvider` / `TaskItem.api_provider`).
 *
 * A row's stored `totalCost` is an API-rate estimate; for providers the
 * SDK marks with `metadata.usageCostDisplay` other than `"show"` (e.g.
 * subscription-billed ChatGPT Plus/Pro, ClinePass, Claude Code) it is not
 * a real charge, so history surfaces must not render it. This is the
 * per-row counterpart of `useProviderUsageCostDisplay`, which decides for
 * a single provider; history lists mix providers, hence the predicate.
 *
 * Decision table:
 * - No provider recorded on the row (tasks predating the field, legacy
 *   imports) → show; there is nothing to key suppression on.
 * - Listings not loaded yet (or the request failed) → hide; rendering in
 *   that window would flash estimates at subscription users.
 * - Provider absent from the listings, or marked `"show"` → show; the
 *   same default policy the SDK and CLI use.
 */
export function useUsageCostVisibility(): (providerId: string | undefined) => boolean {
	const { providers } = useProviderListings()
	return useCallback(
		(providerId: string | undefined) => {
			if (!providerId) {
				return true
			}
			// Listings are never legitimately empty (builtin providers always
			// exist), so an empty array means "not loaded yet" or "load failed".
			if (providers.length === 0) {
				return false
			}
			const listing = providers.find((p) => p.id === providerId)
			return !listing || !listing.usageCostDisplay || listing.usageCostDisplay === "show"
		},
		[providers],
	)
}
