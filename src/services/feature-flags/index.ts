export {
	type FeatureFlagsProviderConfig,
	FeatureFlagsProviderFactory,
	type FeatureFlagsProviderType,
} from "./FeatureFlagsProviderFactory"
export { FeatureFlagsService } from "./FeatureFlagsService"
export type { FeatureFlagsSettings, IFeatureFlagsProvider } from "./providers/IFeatureFlagsProvider"
export { PostHogFeatureFlagsProvider } from "./providers/PostHogFeatureFlagsProvider"

import { FeatureFlagsProviderFactory } from "./FeatureFlagsProviderFactory"
import { FeatureFlagsService } from "./FeatureFlagsService"

let _featureFlagsServiceInstance: FeatureFlagsService | null = null

/**
 * Get the singleton feature flags service instance
 * @param distinctId Optional distinct ID for the feature flags provider
 * @returns FeatureFlagsService instance
 */
export function getFeatureFlagsService(): FeatureFlagsService {
	if (!_featureFlagsServiceInstance) {
		const provider = FeatureFlagsProviderFactory.createProvider({
			type: "posthog",
		})
		_featureFlagsServiceInstance = new FeatureFlagsService(provider)
	}
	return _featureFlagsServiceInstance
}

/**
 * Reset the feature flags service instance (useful for testing)
 */
export function resetFeatureFlagsService(): void {
	_featureFlagsServiceInstance = null
}

export const featureFlagsService = new Proxy({} as FeatureFlagsService, {
	get(_target, prop, _receiver) {
		const service = getFeatureFlagsService()
		return Reflect.get(service, prop, service)
	},
})
