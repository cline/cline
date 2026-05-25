import type { Controller } from "@core/controller"
import { startPreviewAgentTask } from "./startPreviewAgentTask"

/**
 * Handles the `aihydro-preview-agent-task` postMessage from the preview
 * webview panel. Mirrors `handleMapAgentTaskMessage` in
 * `src/core/map/handleMapAgentTask.ts`.
 */
export async function handlePreviewAgentTaskMessage(
	controller: Controller,
	message: { requestId?: string; prompt?: string },
	postMessage: (response: Record<string, unknown>) => void | Promise<void>,
): Promise<void> {
	const requestId = message.requestId ?? "unknown"
	const prompt = typeof message.prompt === "string" ? message.prompt : ""
	const result = await startPreviewAgentTask(controller, prompt)
	await postMessage({
		type: "aihydro-preview-agent-result",
		requestId,
		ok: result.ok,
		error: result.error,
	})
}
