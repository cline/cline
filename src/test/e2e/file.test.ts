import { expect } from "@playwright/test"
import { e2e } from "./utils/helpers"

e2e("code actions", async ({ page, sidebar }) => {
	await sidebar.getByRole("button", { name: "Get Started for Free" }).click({ delay: 100 })

	// Verify the help improve banner is visible and can be closed.
	await sidebar.getByRole("button", { name: "Close banner and enable" }).click()

	// Verify the release banner is visible for new installs and can be closed.
	await sidebar.getByTestId("close-button").locator("span").first().click()

	// Sidebar
	const sidebarInput = sidebar.getByTestId("chat-input")
	await expect(sidebarInput).toHaveValue("")

	await page
		.getByRole("tab", { name: /Explorer / })
		.locator("a")
		.click()
	await page.getByRole("treeitem", { name: "index.html" }).locator("a").click()
	await page.getByText("index.htmlhtml").click()
	await page
		.getByRole("tab", { name: /Cline / })
		.locator("a")
		.click()
	await page.locator("div:nth-child(4) > span > span").first().click()
	await page.getByRole("textbox", { name: "The editor is not accessible" }).press("ControlOrMeta+a")

	// Added to sidebar
	await page.getByRole("listbox", { name: /Show Code Actions / }).click()
	await page.getByText("Add to Cline").hover()
	await page.getByText("Add to Cline").click()
	await expect(sidebarInput).not.toHaveValue("")

	await page.getByRole("button", { name: "Open in Editor" }).click()
	await page.waitForLoadState("load")
	const clineEditorTab = page.getByRole("tab", { name: "Cline, Editor Group" })
	await expect(clineEditorTab).toBeVisible()

	// TODO: Get the frame of the Cline editor
})
