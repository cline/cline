import { useMemo } from "react"
import { useProviderListings } from "./useProviderListings"

/**
 * Surfaces the SDK's `usageCostDisplay` decision for a single provider
 * id. The decision originates in the `@cline/llms` SDK (see
 * `resolveProviderUsageCostDisplay` in
 * `apps/vscode/src/sdk/model-catalog/catalog.ts`) and is propagated
 * through the `ProviderListing.usage_cost_display` gRPC field.
 *
 * 返回 `"hide"` when the SDK reports a subscription-style provider
 * whose per-token / total cost displays should be suppressed (matches
 * the CLI's `shouldShowCliUsageCost` consumer in `sdk/apps/cli`). Falls
 * back to `"show"` while the listings are still loading or for any
 * provider the SDK does not explicitly mark — the same default policy
 * the SDK and CLI use.
 *
 * Webview consumers must pass the returned value into
 * `ModelInfoView.hideUsageCost` (and equivalent cost-display sites)
 * rather than re-deriving it. If a new provider needs to suppress cost,
 * set `metadata.usageCostDisplay = "hide"` in the SDK provider builtin;
 * the webview picks it up without any change here.
 */
export function useProviderUsageCostDisplay(providerId: string | undefined): "show" | "hide" {
	const { providers } = useProviderListings()
	return useMemo(() => {
		if (!providerId) {
			return "show"
		}
		const listing = providers.find((p) => p.id === providerId)
		return listing?.usageCostDisplay === "hide" ? "hide" : "show"
	}, [providers, providerId])
}
