import { SECRET_STATE_KEYS, ProviderSettings } from "@roo-code/types"

export function checkExistKey(config: ProviderSettings | undefined) {
	if (!config) {
		return false
	}

	// Special case for human-relay and fake-ai providers which don't need any configuration.
	if (config.apiProvider === "human-relay" || config.apiProvider === "fake-ai") {
		return true
	}

	// Check all secret keys from the centralized SECRET_STATE_KEYS array.
	const hasSecretKey = SECRET_STATE_KEYS.some((key) => config[key] !== undefined)

	// Check additional non-secret configuration properties
	const hasOtherConfig = [
		config.awsRegion,
		config.vertexProjectId,
		config.ollamaModelId,
		config.lmStudioModelId,
		config.vsCodeLmModelSelector,
	].some((value) => value !== undefined)

	return hasSecretKey || hasOtherConfig
}
