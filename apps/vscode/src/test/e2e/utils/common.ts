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

	// Target the explicit action instead of pressing Enter on the first item.
	// The first item can vary by platform or diagnostics.
	const addToCline = _page.getByRole("option", { name: /^Add to Cline(?:,|$)/ })
	await addToCline.waitFor({ state: "visible" })

	// VS Code's action widget uses a transient pointer-blocking overlay that can
	// dismiss the menu without invoking its command in Electron automation.
	// We asserted the action above; invoke the same contributed command through
	// the command palette to verify the extension command and chat integration.
	await _page.keyboard.press("Escape")
	await _page.keyboard.press("ControlOrMeta+Shift+p")
	const commandInput = _page.locator(".quick-input-widget").getByRole("textbox")
	await commandInput.fill("> Cline: Add to Cline")
	await _page.keyboard.press("Enter")
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
