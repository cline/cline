import { expect } from "@playwright/test"
import { e2e } from "./utils/helpers"

// Test for setting up API keys
e2e("Views - can set up API keys and navigate to Settings from Chat", async ({ sidebar }) => {
	// Use the page object to interact with editor outside the sidebar
	// Verify initial state
	await expect(sidebar.getByRole("button", { name: "Login to Cline" })).toBeVisible()
	await expect(sidebar.getByText("Bring my own API key")).toBeVisible()

	// Navigate to API key setup
	await sidebar.getByText("Bring my own API key").click()
	await sidebar.getByRole("button", { name: "Continue" }).click()

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
	await sidebar.getByRole("button", { name: "Continue" }).click()

	await expect(sidebar.getByRole("button", { name: "Login to Cline" })).not.toBeVisible()

	// Verify start up page is no longer visible
	await expect(apiKeyInput).not.toBeVisible()
	await expect(providerSelectorInput).not.toBeVisible()

	// Verify the "What's New" modal is visible for new installs and can be closed.
	const dialog = sidebar.getByRole("heading", {
		name: /^🎉 New in v\d/,
	})
	await expect(dialog).toBeVisible()
	await sidebar.getByRole("button", { name: "Close" }).click()
	await expect(dialog).not.toBeVisible()

	// Verify you are now in the chat page after setup was completed and the dialog was closed.
	// cline logo container
	const clineLogo = sidebar.locator(".size-20")
	await expect(clineLogo).toBeVisible()
	const chatInputBox = sidebar.getByTestId("chat-input")
	await expect(chatInputBox).toBeVisible()

	// Verify What's New Section is showing and starts with first banner,
	// and the navigation buttons work
	await expect(sidebar.locator(".animate-fade-in")).toBeVisible()
	await expect(
		sidebar
			.locator("div")
			.filter({ hasText: /^1 \/ 3$/ })
			.first(),
	).toBeVisible()
	await sidebar.getByRole("button", { name: "Next banner" }).click()
	await expect(
		sidebar
			.locator("div")
			.filter({ hasText: /^2 \/ 3$/ })
			.first(),
	).toBeVisible()
	await sidebar.getByRole("button", { name: "Previous banner" }).click()
	await expect(
		sidebar
			.locator("div")
			.filter({ hasText: /^1 \/ 3$/ })
			.first(),
	).toBeVisible()
})
