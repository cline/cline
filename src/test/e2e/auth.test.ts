import { expect } from "@playwright/test"
import { e2e } from "./utils/helpers"

// Test for setting up API keys
e2e("Views - can set up API keys and navigate to Settings from Chat", async ({ sidebar }) => {
	// Use the page object to interact with editor outside the sidebar
	// Verify initial state
	await expect(sidebar.getByRole("button", { name: "Get Started for Free" })).toBeVisible()
	await expect(sidebar.getByRole("button", { name: "Use your own API key" })).toBeVisible()

	// Navigate to API key setup
	await sidebar.getByRole("button", { name: "Use your own API key" }).click()

	const providerSelectorInput = sidebar.getByTestId("provider-selector-input")

	// Verify provider selector is visible
	await expect(providerSelectorInput).toBeVisible()

	// Test Cline provider option
	await providerSelectorInput.click({ delay: 100 })
	// Wait for dropdown to appear and find Cline option
	await expect(sidebar.getByTestId("provider-option-cline")).toBeVisible()
	await sidebar.getByTestId("provider-option-cline").click({ delay: 100 })
	await expect(sidebar.getByRole("button", { name: "Sign Up with Cline" })).toBeVisible()

	// Switch to OpenRouter and complete setup
	await providerSelectorInput.click({ delay: 100 })
	await sidebar.getByTestId("provider-option-openrouter").click({ delay: 100 })

	const apiKeyInput = sidebar.getByRole("textbox", {
		name: "OpenRouter API Key",
	})
	await apiKeyInput.fill("test-api-key")
	await expect(apiKeyInput).toHaveValue("test-api-key")
	await apiKeyInput.click({ delay: 100 })
	const submitButton = sidebar.getByRole("button", { name: "Let's go!" })
	await expect(submitButton).toBeEnabled()
	await submitButton.click({ delay: 100 })
	await expect(sidebar.getByRole("button", { name: "Get Started for Free" })).not.toBeVisible()

	// Verify start up page is no longer visible
	await expect(apiKeyInput).not.toBeVisible()
	await expect(providerSelectorInput).not.toBeVisible()

	// Verify you are now in the chat page after setup was completed
	// cline logo has the name "clline-logo"
	const clineLogo = sidebar.locator(".size-20 > path")
	await expect(clineLogo).toBeVisible()
	const chatInputBox = sidebar.getByTestId("chat-input")
	await expect(chatInputBox).toBeVisible()

	// Verify the release banner is visible for new installs and can be closed.
	const releaseBanner = sidebar.getByRole("heading", {
		name: /^🎉 New in v\d/,
	})
	await expect(releaseBanner).toBeVisible()
	await sidebar.getByTestId("close-announcement-button").click()
	await expect(releaseBanner).not.toBeVisible()
})
