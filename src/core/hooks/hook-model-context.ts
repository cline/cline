import type { ApiHandler } from "@core/api"
import type { StateManager } from "@core/storage/StateManager"
import type { ApiProvider } from "@shared/api"
import { getProviderModelIdKey } from "@shared/storage/provider-keys"
import type { HookModelInputContext } from "./hook-factory"

/**
 * Resolve the active provider/model pair used for hook payload metadata.
 */
export function getHookModelContext(api: ApiHandler, stateManager: StateManager): HookModelInputContext {
	const mode = stateManager.getGlobalSettingsKey("mode")
	const apiConfig = stateManager.getApiConfiguration()
	const provider = (mode === "plan" ? apiConfig.planModeApiProvider : apiConfig.actModeApiProvider) as ApiProvider | undefined

	const modelKey = provider ? getProviderModelIdKey(provider, mode === "plan" ? "plan" : "act") : undefined
	const configRecord = apiConfig as Record<string, unknown>
	const providerModelSlug = modelKey ? (configRecord[modelKey] as string | undefined) : undefined
	const genericModelSlug = configRecord[`${mode}ModeApiModelId`] as string | undefined
	const activeHandlerModelSlug = api.getModel().id
	const slug = providerModelSlug || genericModelSlug || activeHandlerModelSlug

	return {
		provider: provider || "unknown",
		slug: slug || "unknown",
	}
}
