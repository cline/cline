export { FeatureFlagsService } from "@cline/core"

import { FeatureFlagsService, FEATURE_FLAGS as SDK_FEATURE_FLAGS } from "@cline/core"
import { getDistinctId } from "@/services/logging/distinctId"
import { telemetryService } from "@/services/telemetry"
import { FEATURE_FLAGS as EXTENSION_FEATURE_FLAGS, FeatureFlagDefaultValue } from "@/shared/services/feature-flags/feature-flags"
import { Logger } from "@/shared/services/Logger"
import { FeatureFlagsProviderFactory } from "./FeatureFlagsProviderFactory"

const FEATURE_FLAGS = [...new Set([...SDK_FEATURE_FLAGS, ...EXTENSION_FEATURE_FLAGS])]

let _featureFlagsServiceInstance: FeatureFlagsService | null = null

/**
 * Get the singleton feature flags service instance
 * @param distinctId Optional distinct ID for the feature flags provider
 * @returns FeatureFlagsService instance
 */
export function getFeatureFlagsService(): FeatureFlagsService {
	if (!_featureFlagsServiceInstance) {
		const provider = FeatureFlagsProviderFactory.createProvider(FeatureFlagsProviderFactory.getDefaultConfig())
		_featureFlagsServiceInstance = new FeatureFlagsService({
			provider,
			telemetry: telemetryService,
			logger: Logger,
			context: {
				distinctId: getDistinctId(),
				clientName: "vscode",
			},
			flagKeys: FEATURE_FLAGS,
			defaultValues: FeatureFlagDefaultValue,
		})
	}
	return _featureFlagsServiceInstance
}

export const featureFlagsService = new Proxy({} as FeatureFlagsService, {
	get(_target, prop, _receiver) {
		const service = getFeatureFlagsService()
		const value = Reflect.get(service, prop, service)
		// Bind methods to the service instance to preserve `this` context
		if (typeof value === "function") {
			return value.bind(service)
		}
		return value
	},
})
