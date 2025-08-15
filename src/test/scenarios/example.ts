import { expect } from "@playwright/test"
import { e2e } from "../e2e/utils/helpers"

// Minimal scenario test using the same E2E fixture stack
// This verifies we can open the Cline sidebar and interact with the chat input.
e2e("Scenario - basic smoke: sidebar opens and chat input visible", async ({ helper, sidebar }) => {
	// Complete initial setup (mock BYOK API key)
	await helper.signin(sidebar)

	// Verify chat input is available
	const input = sidebar.getByTestId("chat-input")
	await expect(input).toBeVisible()
})
