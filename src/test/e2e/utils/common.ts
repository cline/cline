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

export const closeBanners = async (sidebar: Page) => {
	const banners = ["Get Started for Free", "Close banner and enable"]

	for (const banner of banners) {
		await sidebar.getByRole("button", { name: banner }).click({ delay: 100 })
	}
}

export async function cleanChatView(sidebar: Page): Promise<Page> {
	const signUpBtn = sidebar.getByRole("button", { name: "Get Started for Free" })
	if (await signUpBtn.isVisible()) {
		await signUpBtn.click({ delay: 50 })
	}
	// Verify the help improve banner is visible and can be closed.
	const helpBanner = sidebar.getByText("Help Improve Cline")
	if (await helpBanner.isVisible()) {
		await sidebar.getByRole("button", { name: "Close banner and enable" }).click()
	}

	// Verify the release banner is visible for new installs and can be closed.
	const releaseBanner = sidebar.getByRole("heading", {
		name: /^🎉 New in v\d/,
	})
	if (await releaseBanner.isVisible()) {
		await sidebar.getByTestId("close-button").locator("span").first().click()
	}

	return sidebar
}
