import { waitForMessage } from "./utils"

suite("Roo Code Task", () => {
	test("Should handle prompt and response correctly", async function () {
		const api = globalThis.api
		await api.setConfiguration({ mode: "Ask", alwaysAllowModeSwitch: true, autoApprovalEnabled: true })
		await api.startNewTask("Hello world, what is your name? Respond with 'My name is ...'")
		await waitForMessage(api, { include: "My name is Roo" })
	})
})
