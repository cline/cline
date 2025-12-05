import type { Page } from "@playwright/test"

export const openTab = async (_page: Page, tabName: string) => {
	await _page
		.getByRole("tab", { name: new RegExp(`${tabName}`) })
		.locator("a")
		.click()
}

export const addSelectedCodeToClineWebview = async (_page: Page) => {
	await _page.locator("div:nth-child(4) > span > span").first().click()
	await _page.getByRole("textbox", { name: "The editor is not accessible" }).press("ControlOrMeta+a")

	// Open Code Actions via keyboard for cross-platform reliability
	await _page.keyboard.press("ControlOrMeta+.")
	// Wait for the Code Actions UI to appear (listbox or menu depending on platform/version)
	try {
		await _page.getByRole("listbox").first().waitFor({ state: "visible", timeout: 5000 })
	} catch {
		await _page.getByRole("menu").first().waitFor({ state: "visible", timeout: 5000 })
	}
	await _page.keyboard.press("Enter", { delay: 100 }) // First action - "Add to Cline"
}

export const toggleNotifications = async (_page: Page) => {
	await _page.waitForLoadState("domcontentloaded")
	await _page.keyboard.press("ControlOrMeta+Shift+p")
	const editorSearchBar = _page.getByRole("textbox")
	if (!editorSearchBar.isVisible()) {
		await _page.keyboard.press("ControlOrMeta+Shift+p")
	}
	await editorSearchBar.click({ delay: 100 }) // Ensure focus
	await editorSearchBar.fill("> Toggle Do Not Disturb Mode")
	await _page.keyboard.press("Enter")
	return _page
}
