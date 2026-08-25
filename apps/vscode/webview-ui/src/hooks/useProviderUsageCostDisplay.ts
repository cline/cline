import { useMemo } from "react"
import { useProviderListings } from "./useProviderListings"

export type UsageCostDisplay = "show" | "hide" | "subscription"

const USAGE_COST_DISPLAYS: readonly UsageCostDisplay[] = ["show", "hide", "subscription"]

function isUsageCostDisplay(value: string | undefined): value is UsageCostDisplay {
	return !!value && USAGE_COST_DISPLAYS.includes(value as UsageCostDisplay)
}

/**
 * Surfaces the SDK's `usageCostDisplay` decision for a single provider
 * id. The decision originates in the `@cline/llms` SDK (see
 * `resolveProviderUsageCostDisplay` in
 * `apps/vscode/src/sdk/model-catalog/catalog.ts`) and is propagated
 * through the `ProviderListing.usage_cost_display` gRPC field.
 *
 * Returns `"hide"` when cost is unknowable or meaningless for the
 * provider, and `"subscription"` when usage is billed through a
 * flat-rate subscription (e.g. ChatGPT Plus/Pro, ClinePass) — in that
 * case any computed dollar figure is a per-token API-rate estimate, not
 * an actual charge. Cost displays must render only for `"show"`, which
 * matches the CLI's `shouldShowCliUsageCost` consumer. Falls back to
 * `"show"` while the listings are still loading or for any provider the
 * SDK does not explicitly mark — the same default policy the SDK and
 * CLI use.
 *
 * Webview consumers must derive cost visibility from the returned value
 * (`=== "show"`, or `ModelInfoView.hideUsageCost`) rather than
 * re-deriving it per provider. If a new provider needs to suppress
 * cost, set `metadata.usageCostDisplay` in the SDK provider builtin;
 * the webview picks it up without any change here.
 */
export function useProviderUsageCostDisplay(providerId: string | undefined): UsageCostDisplay {
	const { providers } = useProviderListings()
	return useMemo(() => {
		if (!providerId) {
			return "show"
		}
		const value = providers.find((p) => p.id === providerId)?.usageCostDisplay
		return isUsageCostDisplay(value) ? value : "show"
	}, [providers, providerId])
}
