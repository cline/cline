import type { ApiHandler } from "@core/api"
import type { StateManager } from "@core/storage/StateManager"
import type { HookModelInputContext } from "./hook-factory"

/**
 * Resolve the active provider/model pair used for hook payload metadata.
 */
export function getHookModelContext(api: ApiHandler, stateManager: StateManager): HookModelInputContext {
	const mode = stateManager.getGlobalSettingsKey("mode")
	const apiConfig = stateManager.getApiConfiguration()
	const provider = (mode === "plan" ? apiConfig.planModeApiProvider : apiConfig.actModeApiProvider) as string | undefined
	const slug = api.getModel().id

	return {
		provider: provider || "unknown",
		slug: slug || "unknown",
	}
}
