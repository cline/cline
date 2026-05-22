import type { Controller } from "@core/controller"
import { startMapAgentTask } from "./startMapAgentTask"

export async function handleMapAgentTaskMessage(
	controller: Controller,
	message: { requestId?: string; prompt?: string },
	postMessage: (response: Record<string, unknown>) => void | Promise<void>,
): Promise<void> {
	const requestId = message.requestId ?? "unknown"
	const prompt = typeof message.prompt === "string" ? message.prompt : ""
	const result = await startMapAgentTask(controller, prompt)
	await postMessage({
		type: "aihydro-map-agent-result",
		requestId,
		ok: result.ok,
		error: result.error,
	})
}
