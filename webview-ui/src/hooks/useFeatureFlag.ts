import { useFeatureFlagPayload } from "posthog-js/react"

export const useFeatureFlag = (flagName: string): boolean => {
	try {
		const payload = useFeatureFlagPayload(flagName) as { enabled: boolean }
		if (payload && typeof payload === "object") {
			// Check if the enabled property exists and is a boolean
			if ("enabled" in payload && typeof payload.enabled === "boolean") {
				return payload.enabled
			}
		}
	} catch (error) {
		console.error(`Error retrieving feature flag "${flagName}":`, error)
	}
	return false
}
