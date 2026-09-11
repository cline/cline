import type { Controller } from "../index"

export async function sendContextMenuPrompt(controller: Controller, prompt: string): Promise<void> {
	if (controller.task) {
		await controller.task.handleWebviewAskResponse("messageResponse", prompt)
		return
	}

	await controller.initTask(prompt)
}
