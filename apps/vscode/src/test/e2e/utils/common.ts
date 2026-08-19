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
	// The action widget briefly overlays a pointer blocker while positioning.
	// Activate the exact option from the keyboard instead of racing that overlay.
	await _page.keyboard.press("Home")
	const actionCount = await _page.getByRole("option").count()
	for (
		let index = 0;
		index < actionCount && !(await addToCline.evaluate((element) => element.classList.contains("focused")));
		index++
	) {
		await _page.keyboard.press("ArrowDown")
	}
	if (!(await addToCline.evaluate((element) => element.classList.contains("focused")))) {
		throw new Error("Could not focus the Add to Cline code action")
	}
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
