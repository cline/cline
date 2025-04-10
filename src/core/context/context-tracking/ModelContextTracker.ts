import * as vscode from "vscode"
import { getTaskMetadata, saveTaskMetadata } from "../../storage/disk"
import type { ControllerLike } from "./ContextTrackerTypes"

export class ModelContextTracker {
	readonly taskId: string
	private controllerRef: WeakRef<ControllerLike>

	constructor(controller: ControllerLike, taskId: string) {
		this.controllerRef = new WeakRef(controller)
		this.taskId = taskId
	}

	// While a task is ref'd by a controller, it will always have access to the extension context
	// This error is thrown if the controller derefs the task after e.g., aborting the task
	private context(): vscode.ExtensionContext {
		const context = this.controllerRef.deref()?.context
		if (!context) {
			throw new Error("Unable to access extension context")
		}
		return context
	}

	async recordModelUsage(apiProviderId: string, modelId: string, mode: string) {
		const context = this.context()
		const metadata = await getTaskMetadata(context, this.taskId)

		if (!metadata.model_usage) {
			metadata.model_usage = []
		}

		// check to see if the last entry is the same as the new one
		const lastEntry = metadata.model_usage[metadata.model_usage.length - 1]
		if (
			lastEntry &&
			lastEntry.model_id === modelId &&
			lastEntry.model_provider_id === apiProviderId &&
			lastEntry.mode === mode
		) {
			return
		}

		metadata.model_usage.push({
			ts: Date.now(),
			model_id: modelId,
			model_provider_id: apiProviderId,
			mode: mode,
		})

		await saveTaskMetadata(context, this.taskId, metadata)
	}
}
