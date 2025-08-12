import { expect } from "@playwright/test"
import { addSelectedCodeToClineWebview, getClineEditorWebviewFrame, openTab, toggleNotifications } from "./utils/common"
import { e2e } from "./utils/helpers"

e2e("code actions and editor panel", async ({ page, sidebar }) => {
	await toggleNotifications(page)

	await sidebar.getByRole("button", { name: "Get Started for Free" }).click({ delay: 100 })

	// Verify the help improve banner is visible and can be closed.
	await sidebar.getByRole("button", { name: "Close banner and enable" }).click()

	// Verify the release banner is visible for new installs and can be closed.
	await sidebar.getByTestId("close-button").locator("span").first().click()

	// Sidebar - input should start empty
	const sidebarInput = sidebar.getByTestId("chat-input")
	await expect(sidebarInput).toBeEmpty()

	// Open file tree and select code from file
	await openTab(page, "Explorer ")
	await page.getByRole("treeitem", { name: "index.html" }).locator("a").click()
	await expect(sidebarInput).not.toBeFocused()

	// Sidebar should be opened and visible after adding code to Cline
	await addSelectedCodeToClineWebview(page)
	await expect(sidebarInput).not.toBeEmpty()
	await expect(sidebarInput).toBeFocused()

	await page.getByRole("button", { name: "Open in Editor" }).click()
	await page.waitForLoadState("load")
	const clineEditorTab = page.getByRole("tab", { name: "Cline, Editor Group" })
	await expect(clineEditorTab).toBeVisible()

	// Editor Panel
	const clineEditorWebview = await getClineEditorWebviewFrame(page)

	await clineEditorWebview.getByTestId("chat-input").click()
	await expect(clineEditorWebview.getByTestId("chat-input")).toBeEmpty()
	await addSelectedCodeToClineWebview(page)
	await expect(clineEditorWebview.getByTestId("chat-input")).not.toBeEmpty()
})
