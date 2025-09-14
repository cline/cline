import { expect, Frame, Page } from "@playwright/test"
import { cleanChatView } from "./utils/common"
import { e2e, e2eMultiRoot } from "./utils/helpers"

/**
 * Shared test logic for diff editor tests
 * @param page - Playwright page object
 * @param sidebar - Sidebar frame for the Cline extension
 */
async function testDiffEditor(page: Page, sidebar: Frame) {
	await sidebar.getByRole("button", { name: "Get Started for Free" }).click({ delay: 100 })
	// Submit a message
	await cleanChatView(page)

	const inputbox = sidebar.getByTestId("chat-input")
	await expect(inputbox).toBeVisible()

	await inputbox.fill("Hello, Cline!")
	await expect(inputbox).toHaveValue("Hello, Cline!")
	await sidebar.getByTestId("send-button").click({ delay: 100 })
	await expect(inputbox).toHaveValue("")

	// Loading State initially
	await expect(sidebar.getByText("API Request...")).toBeVisible()

	// Back to home page with history
	await sidebar.getByRole("button", { name: "Start New Task" }).click()
	await expect(sidebar.getByText("Recent Tasks")).toBeVisible()
	await expect(sidebar.getByText("Hello, Cline!")).toBeVisible() // History with the previous sent message
	await expect(sidebar.getByText("Tokens:")).toBeVisible() // History with token usage

	// Submit a file edit request
	await sidebar.getByTestId("chat-input").click()
	await sidebar.getByTestId("chat-input").fill("edit_request")
	await sidebar.getByTestId("send-button").click({ delay: 50 })

	// Wait for the sidebar to load the file edit request
	await sidebar.waitForSelector('span:has-text("Cline wants to edit this file:")')

	// Cline Diff Editor should open with the file name and diff
	await expect(page.getByText("test.ts: Original ↔ Cline's")).toBeVisible()

	// Diff editor should show the original and modified content
	const diffEditor = page.locator(
		".monaco-editor.modified-in-monaco-diff-editor > .overflow-guard > .monaco-scrollable-element.editor-scrollable > .lines-content > div:nth-child(4)",
	)
	await diffEditor.click()
	await expect(diffEditor).toBeVisible()

	await page.close()
}

e2e("Diff editor", async ({ page, sidebar }) => {
	await testDiffEditor(page, sidebar)
})

e2eMultiRoot("[Multi-roots] Diff editor", async ({ page, sidebar }) => {
	await testDiffEditor(page, sidebar)
})
