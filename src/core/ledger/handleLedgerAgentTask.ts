import type { Controller } from "@core/controller"
import { startLedgerAgentTask } from "./startLedgerAgentTask"

/**
 * Handles the `aihydro-ledger-agent-task` postMessage from the Evidence
 * Board webview panel. Mirrors handlePreviewAgentTaskMessage /
 * handleMapAgentTaskMessage.
 */
export async function handleLedgerAgentTaskMessage(
	controller: Controller,
	message: { requestId?: string; prompt?: string },
	postMessage: (response: Record<string, unknown>) => void | Promise<void>,
): Promise<void> {
	const requestId = message.requestId ?? "unknown"
	const prompt = typeof message.prompt === "string" ? message.prompt : ""
	const result = await startLedgerAgentTask(controller, prompt)
	await postMessage({
		type: "aihydro-ledger-agent-result",
		requestId,
		ok: result.ok,
		error: result.error,
	})
}
