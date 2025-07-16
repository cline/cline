import { expect } from "@playwright/test"
import { e2e } from "./utils/helpers"

e2e("Auth - can set up API keys", async ({ page, sidebar }) => {
	// Verify initial state
	await expect(sidebar.getByRole("button", { name: "Get Started for Free" })).toBeVisible()
	await expect(sidebar.getByRole("button", { name: "Use your own API key" })).toBeVisible()

	// Navigate to API key setup
	await sidebar.getByRole("button", { name: "Use your own API key" }).click()

	const providerSelector = sidebar.locator("#api-provider div").first()

	// Verify provider selector is visible and set to OpenRouter
	await expect(sidebar.locator("slot").filter({ hasText: /^OpenRouter$/ })).toBeVisible()

	// Test Cline provider option
	await providerSelector.click({ delay: 100 })
	await expect(sidebar.getByRole("option", { name: "Cline" })).toBeVisible()
	await sidebar.getByRole("option", { name: "Cline" }).click({ delay: 100 })
	await expect(sidebar.getByRole("button", { name: "Sign Up with Cline" })).toBeVisible()

	// Switch to OpenRouter and complete setup
	await providerSelector.click({ delay: 100 })
	await sidebar.getByRole("option", { name: "OpenRouter" }).click({ delay: 100 })

	const apiKeyInput = sidebar.getByRole("textbox", { name: "OpenRouter API Key" })
	await apiKeyInput.fill("test-api-key")
	await expect(apiKeyInput).toHaveValue("test-api-key")
	await apiKeyInput.click({ delay: 100 })
	const submitButton = sidebar.getByRole("button", { name: "Let's go!" })
	await expect(submitButton).toBeEnabled()
	await submitButton.click({ delay: 100 })
	await expect(sidebar.getByRole("button", { name: "Get Started for Free" })).not.toBeVisible()

	// Verify start up page is no longer visible
	await expect(apiKeyInput).not.toBeVisible()
	await expect(providerSelector).not.toBeVisible()

	// Verify you are now in the chat page after setup was completed
	const clineLogo = sidebar.getByRole("img").filter({ hasText: /^$/ }).locator("path")
	await expect(clineLogo).toBeVisible()
	const chatInputBox = sidebar.getByTestId("chat-input")
	await expect(chatInputBox).toBeVisible()

	// Verify the help improve banner is visible and can be closed.
	const helpBanner = sidebar.getByText("Help Improve Cline")
	await expect(helpBanner).toBeVisible()
	await sidebar.getByRole("button", { name: "Close banner and enable" }).click()
	await expect(helpBanner).not.toBeVisible()

	// Verify the release banner is visible for new installs and can be closed.
	const releaseBanner = sidebar.getByRole("heading", { name: /^🎉 New in v\d/ })
	await expect(releaseBanner).toBeVisible()
	await sidebar.getByTestId("close-button").locator("span").first().click()
	await expect(releaseBanner).not.toBeVisible()
})
