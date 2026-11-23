import { useCallback, useMemo } from "react"
import { buildClinePassSubscribeUrl, buildClinePassSubscriptionPageUrl } from "@/components/onboarding/clinePassSubscribe"
import { useApiConfigurationHandlers } from "@/components/settings/utils/useApiConfigurationHandlers"
import { useClineAuth } from "@/context/ClineAuthContext"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { UiServiceClient } from "@/services/grpc-client"

export const CLINE_PASS_PROVIDER_ID = "cline-pass"

/**
 * Shared state + actions for the ClinePass promotional surfaces (home banner,
 * account page card, settings provider hint). Promotions are hidden in
 * self-hosted mode (ClinePass is a cloud subscription) and behind org
 * remote-config provider allowlists so they never offer a provider the
 * organization disallows.
 */
export function useClinePassPromo() {
	const { apiConfiguration, environment, navigateToSettings, remoteConfigSettings, mode, planActSeparateModelsSetting } =
		useExtensionState()
	const { clineUser } = useClineAuth()
	const { handleModeFieldChange } = useApiConfigurationHandlers()

	const isSelfHostedOrUnknown = !environment || environment === "selfHosted"
	const remoteProviders: string[] = remoteConfigSettings?.remoteConfiguredProviders || []
	const isBlockedByRemoteConfig = remoteProviders.length > 0 && !remoteProviders.includes(CLINE_PASS_PROVIDER_ID)
	const isClinePassEnabled = !isSelfHostedOrUnknown && !isBlockedByRemoteConfig

	// Mirrors the switch action's scope: with separate plan/act models the
	// promos only affect (and therefore only reflect) the current mode.
	const currentModeProvider = mode === "plan" ? apiConfiguration?.planModeApiProvider : apiConfiguration?.actModeApiProvider
	const isUsingClinePass = planActSeparateModelsSetting
		? currentModeProvider === CLINE_PASS_PROVIDER_ID
		: apiConfiguration?.planModeApiProvider === CLINE_PASS_PROVIDER_ID ||
			apiConfiguration?.actModeApiProvider === CLINE_PASS_PROVIDER_ID

	const subscribeUrl = useMemo(() => buildClinePassSubscribeUrl(clineUser?.appBaseUrl), [clineUser?.appBaseUrl])
	const manageSubscriptionUrl = useMemo(() => buildClinePassSubscriptionPageUrl(clineUser?.appBaseUrl), [clineUser?.appBaseUrl])

	const openSubscribePage = useCallback(() => {
		UiServiceClient.openUrl({ value: subscribeUrl }).catch((err) =>
			console.error("Failed to open ClinePass subscribe page:", err),
		)
	}, [subscribeUrl])

	const openManageSubscriptionPage = useCallback(() => {
		UiServiceClient.openUrl({ value: manageSubscriptionUrl }).catch((err) =>
			console.error("Failed to open ClinePass subscription page:", err),
		)
	}, [manageSubscriptionUrl])

	// Selects ClinePass without navigating (for surfaces that already show the
	// provider settings inline). Mirrors the provider dropdown: updates both
	// modes, or only the current mode when plan/act use separate models, so the
	// other mode's provider is never silently overwritten. Returns whether the
	// provider update actually succeeded.
	const selectClinePassProvider = useCallback(async (): Promise<boolean> => {
		try {
			await handleModeFieldChange({ plan: "planModeApiProvider", act: "actModeApiProvider" }, CLINE_PASS_PROVIDER_ID, mode)
			return true
		} catch (error) {
			console.error("Failed to switch to ClinePass provider:", error)
			return false
		}
	}, [handleModeFieldChange, mode])

	// Selects ClinePass for both modes and lands the user on the provider
	// settings so they can pick a model / sign in. Only navigates when the
	// provider update succeeded, so a failure doesn't strand the user on the
	// settings page with their old provider still selected.
	const switchToClinePassProvider = useCallback(async () => {
		if (await selectClinePassProvider()) {
			navigateToSettings("api-config")
		}
	}, [selectClinePassProvider, navigateToSettings])

	return {
		isClinePassEnabled,
		isUsingClinePass,
		subscribeUrl,
		manageSubscriptionUrl,
		openSubscribePage,
		openManageSubscriptionPage,
		selectClinePassProvider,
		switchToClinePassProvider,
	}
}
