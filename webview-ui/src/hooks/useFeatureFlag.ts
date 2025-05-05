import { useFeatureFlagPayload } from "posthog-js/react"

export const useFeatureFlag = (flagName: string): boolean => {
	const payload = useFeatureFlagPayload(flagName) as { enabled: boolean }
	if (payload && payload.enabled) {
		return payload.enabled
	}
	console.warn(`Feature flag ${flagName} not found or missing enabled property.`)
	return false
}
