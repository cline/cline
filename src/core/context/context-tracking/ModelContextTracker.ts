import { getTaskMetadata, saveTaskMetadata } from "@core/storage/disk"
import * as vscode from "vscode"

export class ModelContextTracker {
	readonly taskId: string
	private context: vscode.ExtensionContext

	constructor(context: vscode.ExtensionContext, taskId: string) {
		this.context = context
		this.taskId = taskId
	}

	async recordModelUsage(apiProviderId: string, modelId: string, mode: string) {
		const metadata = await getTaskMetadata(this.context, this.taskId)

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

		await saveTaskMetadata(this.context, this.taskId, metadata)
	}
}
