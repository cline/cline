import { waitForMessage } from "./utils"

suite("Roo Code Task", () => {
	test("Should handle prompt and response correctly", async function () {
		const api = globalThis.api
		await api.setConfiguration({ mode: "Ask", alwaysAllowModeSwitch: true, autoApprovalEnabled: true })
		const taskId = await api.startNewTask("Hello world, what is your name? Respond with 'My name is ...'")
		await waitForMessage({ api, taskId, include: "My name is Roo" })
	})
})
