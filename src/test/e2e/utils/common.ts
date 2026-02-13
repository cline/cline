import type { Locator, Page } from "@playwright/test"

export const openTab = async (_page: Page, tabName: string) => {
	await _page
		.getByRole("tab", { name: new RegExp(`${tabName}`) })
		.locator("a")
		.click()
}

export const addSelectedCodeToClineWebview = async (_page: Page) => {
	const clickActionIfVisible = async (locator: Locator) => {
		try {
			await locator.waitFor({ state: "visible", timeout: 5000 })
			await locator.click({ delay: 100 })
			return true
		} catch {
			return false
		}
	}

	await _page.locator("div:nth-child(4) > span > span").first().click()
	await _page.getByRole("textbox", { name: "The editor is not accessible" }).press("ControlOrMeta+a")

	// Open Code Actions via keyboard for cross-platform reliability
	await _page.keyboard.press("ControlOrMeta+.")
	// Target the explicit action instead of pressing Enter on the first item.
	// The first item can vary by platform or diagnostics.
	const addToClineOption = _page.getByRole("option", { name: /Add to Cline/i }).first()
	const addToClineMenuItem = _page.getByRole("menuitem", { name: /Add to Cline/i }).first()

	if (await clickActionIfVisible(addToClineOption)) {
		return
	}

	if (await clickActionIfVisible(addToClineMenuItem)) {
		return
	}

	// Fallback for unexpected code action UIs.
	await _page.keyboard.press("Enter", { delay: 100 })
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
