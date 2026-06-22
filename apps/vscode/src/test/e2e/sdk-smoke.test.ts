import { expect } from "@playwright/test"
import { e2e } from "./utils/helpers"

// End-to-end smoke tests for the SDK-rebuilt extension.
//
// These exercise the real extension host in VS Code (via the Playwright/Electron
// harness) and prove the plumbing that connects the webview to the Cline SDK:
//   activate -> webview render -> gRPC -> Controller -> ClineCore -> CoreSessionEvent
//   -> message translator -> ClineMessage -> webview render.

e2e("SDK shell renders the Cline webview", async ({ sidebar }) => {
	// The webview must mount real content (proves activation, the gRPC state
	// subscription, and that the host returns a valid ExtensionState).
	await expect(sidebar.locator("#root > *")).toBeVisible({ timeout: 15_000 })
	await expect(sidebar.getByTestId("chat-input")).toBeVisible()
})

e2e("SDK shell submits a chat message and starts a task through the SDK", async ({ sidebar, page }) => {
	const input = sidebar.getByTestId("chat-input")
	await expect(input).toBeVisible({ timeout: 15_000 })

	await input.click()
	await input.fill("Say hello in one word")
	await expect(input).toHaveValue("Say hello in one word")

	const sendButton = sidebar.getByTestId("send-button")
	await expect(sendButton).toBeEnabled()
	await sendButton.click()

	// Submitting clears the input — confirms the webview accepted the send and dispatched newTask
	// to the host (webview -> gRPC -> Controller.initTask).
	await expect(input).toHaveValue("", { timeout: 15_000 })

	// The task actually starts against the SDK with a resolved provider/model. This is a regression
	// guard for the empty-model bug: an unconfigured model surfaces a Zod "expected string to have
	// >=1 characters" error in the transcript. Its absence means session-config resolved a default
	// model and ClineCore accepted the session.
	await page.waitForTimeout(3000)
	await expect(sidebar.getByText(/expected string to have/i)).not.toBeVisible()
})
