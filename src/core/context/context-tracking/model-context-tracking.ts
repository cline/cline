import { getTaskMetadata, saveTaskMetadata } from "@core/storage/disk"
import * as vscode from "vscode"

/**
 * Records model usage for a task by updating the task metadata
 * @param context The VSCode extension context
 * @param taskId The ID of the task
 * @param apiProviderId The API provider identifier
 * @param modelId The model identifier
 * @param mode The mode (plan/act)
 */
export async function recordModelUsage(
	context: vscode.ExtensionContext,
	taskId: string,
	apiProviderId: string,
	modelId: string,
	mode: string,
): Promise<void> {
	const metadata = await getTaskMetadata(context, taskId)

	if (!metadata.model_usage) {
		metadata.model_usage = []
	}

	// check to see if the last entry is the same as the new one
	const lastEntry = metadata.model_usage[metadata.model_usage.length - 1]
	if (lastEntry && lastEntry.model_id === modelId && lastEntry.model_provider_id === apiProviderId && lastEntry.mode === mode) {
		return
	}

	metadata.model_usage.push({
		ts: Date.now(),
		model_id: modelId,
		model_provider_id: apiProviderId,
		mode: mode,
	})

	await saveTaskMetadata(context, taskId, metadata)
}
