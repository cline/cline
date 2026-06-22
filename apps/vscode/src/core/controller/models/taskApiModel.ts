import type { ApiConfiguration } from "@/shared/api"
import type { Mode } from "@/shared/storage/types"

type TaskApiModel = {
	getModel: () => { id: string }
}

export function resolveActiveModelIdFromApiConfiguration(_config: ApiConfiguration, _mode: Mode): string {
	return "unknown"
}

export function createTaskApiModelShim(modelId: string): TaskApiModel {
	return {
		getModel: () => ({ id: modelId }),
	}
}
