import type { Controller } from "@core/controller"
import { sendChatButtonClickedEvent } from "@core/controller/ui/subscribeToChatButtonClicked"
import { sendFocusChatInputEvent } from "@core/controller/ui/subscribeToFocusChatInput"
import { WebviewProvider } from "@core/webview"
import { VscodeWebviewProvider } from "@/hosts/vscode/VscodeWebviewProvider"

/**
 * Focus chat sidebar and start a new task with a map-seeded prompt.
 */
export async function startMapAgentTask(controller: Controller, prompt: string): Promise<{ ok: boolean; error?: string }> {
	if (!prompt?.trim()) {
		return { ok: false, error: "Empty prompt" }
	}
	try {
		await controller.clearTask()
		await controller.postStateToWebview()
		await sendChatButtonClickedEvent()

		const webview = WebviewProvider.getInstance()
		if (webview instanceof VscodeWebviewProvider) {
			const view = webview.getWebview()
			view?.show()
		}

		await sendFocusChatInputEvent()
		await controller.initTask(prompt.trim(), [], [])
		return { ok: true }
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err)
		console.error("[startMapAgentTask]", message)
		return { ok: false, error: message }
	}
}
