import { expect } from "@playwright/test"
import { addSelectedCodeToClineWebview, getClineEditorWebviewFrame, openTab, toggleNotifications } from "./utils/common"
import { E2E_WORKSPACE_TYPES, e2e } from "./utils/helpers"

e2e.describe("Code Actions and Editor Panel", () => {
	E2E_WORKSPACE_TYPES.forEach(({ title, workspaceType }) => {
		e2e.extend({
			workspaceType,
		})(title, async ({ page, sidebar }) => {
			await sidebar.getByRole("button", { name: "Get Started for Free" }).click({ delay: 100 })
			// Sidebar - input should start empty
			const sidebarInput = sidebar.getByTestId("chat-input")
			await sidebarInput.click()
			await toggleNotifications(page)
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
			await page.close()
		})
	})
})
