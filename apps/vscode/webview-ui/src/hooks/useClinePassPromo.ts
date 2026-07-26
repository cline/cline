import { useCallback, useMemo } from "react"
import { buildClinePassSubscribeUrl, buildClinePassSubscriptionPageUrl } from "@/components/onboarding/clinePassSubscribe"
import { useApiConfigurationHandlers } from "@/components/settings/utils/useApiConfigurationHandlers"
import { CLINE_PASS_FEATURE_FLAG } from "@/constants/featureFlags"
import { useClineAuth } from "@/context/ClineAuthContext"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { useHasFeatureFlag } from "@/hooks/useFeatureFlag"
import { UiServiceClient } from "@/services/grpc-client"

export const CLINE_PASS_PROVIDER_ID = "cline-pass"

/**
 * Shared state + actions for the ClinePass promotional surfaces (home banner,
 * account page card, settings provider hint). Everything is gated behind the
 * ext-cline-pass feature flag, matching the provider dropdown exposure, and
 * behind org remote-config provider allowlists so promotions never offer a
 * provider the organization disallows.
 */
export function useClinePassPromo() {
	const hasClinePassFeatureFlag = useHasFeatureFlag(CLINE_PASS_FEATURE_FLAG)
	const { apiConfiguration, navigateToSettings, remoteConfigSettings } = useExtensionState()
	const { clineUser } = useClineAuth()
	const { handleFieldsChange } = useApiConfigurationHandlers()

	const remoteProviders: string[] = remoteConfigSettings?.remoteConfiguredProviders || []
	const isBlockedByRemoteConfig = remoteProviders.length > 0 && !remoteProviders.includes(CLINE_PASS_PROVIDER_ID)
	const isClinePassEnabled = hasClinePassFeatureFlag && !isBlockedByRemoteConfig

	const isUsingClinePass =
		apiConfiguration?.planModeApiProvider === CLINE_PASS_PROVIDER_ID ||
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

	// Selects ClinePass for both modes without navigating (for surfaces that
	// already show the provider settings inline). Returns whether the provider
	// update actually succeeded.
	const selectClinePassProvider = useCallback(async (): Promise<boolean> => {
		try {
			await handleFieldsChange({
				planModeApiProvider: CLINE_PASS_PROVIDER_ID,
				actModeApiProvider: CLINE_PASS_PROVIDER_ID,
			})
			return true
		} catch (error) {
			console.error("Failed to switch to ClinePass provider:", error)
			return false
		}
	}, [handleFieldsChange])

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
