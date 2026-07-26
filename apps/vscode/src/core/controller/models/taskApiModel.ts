import { type ApiConfiguration, BEDROCK_DEFAULT_MODEL_ID } from "@/shared/api"
import type { Mode } from "@/shared/storage/types"

type TaskApiModel = {
	getModel: () => { id: string }
}

function readString(config: ApiConfiguration, key: keyof ApiConfiguration): string | undefined {
	const value = config[key]
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined
}

export function resolveActiveModelIdFromApiConfiguration(config: ApiConfiguration, mode: Mode): string {
	const genericModelKey = mode === "plan" ? "planModeApiModelId" : "actModeApiModelId"
	return readString(config, genericModelKey) ?? BEDROCK_DEFAULT_MODEL_ID
}

export function createTaskApiModelShim(modelId: string): TaskApiModel {
	return {
		getModel: () => ({ id: modelId }),
	}
}
