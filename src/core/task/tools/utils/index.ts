import type { ApiConfiguration } from "@shared/api"
import type { Mode } from "@shared/storage/types"
import { TaskConfig } from "../types/TaskConfig"

export * from "../types/TaskConfig"
export * from "./ToolConstants"
export { ToolDisplayUtils } from "./ToolDisplayUtils"
export { ToolResultUtils } from "./ToolResultUtils"

export function getModeProvider(apiConfig: ApiConfiguration | undefined, currentMode: Mode): string {
  const modeConfig = currentMode === "plan" ? apiConfig?.planConfig : apiConfig?.actConfig
  return (modeConfig?.apiProvider ?? "anthropic") as string
}

export function getTaskCompletionTelemetry(config: TaskConfig) {
	const currentMode = config.services.stateManager.getGlobalSettingsKey("mode")
	const apiConfig = config.services.stateManager.getApiConfiguration()
	const provider = currentMode === "plan" ? apiConfig.planConfig?.apiProvider : apiConfig.actConfig?.apiProvider
	const model = config.api.getModel()
	const durationMs = Math.max(0, Date.now() - config.taskState.taskStartTimeMs)

	return {
		provider,
		modelId: model.id,
		apiFormat: model.info.apiFormat,
		timeToFirstTokenMs: config.taskState.taskFirstTokenTimeMs,
		durationMs,
		mode: currentMode,
	}
}
