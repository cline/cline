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

	await _page.getByRole("listbox", { name: /Show Code Actions / }).click()
	await _page.keyboard.press("Enter", { delay: 100 }) // First action - "Add to Cline"
}

export const getClineEditorWebviewFrame = async (_page: Page) => {
	return _page.frameLocator("iframe.webview").last().frameLocator("iframe")
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
