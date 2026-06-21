import { expect } from "@playwright/test"
import type { Frame } from "playwright"
import { e2e } from "./utils/helpers"

async function completeBringYourOwnKeyOnboarding(sidebar: Frame) {
	await sidebar.getByText("Bring my own API key").click()
	await sidebar.getByRole("button", { name: "Continue" }).click()

	const onboardingProviderSelectorInput = sidebar.getByTestId("provider-selector-input")
	await expect(onboardingProviderSelectorInput).toBeVisible()
	await onboardingProviderSelectorInput.click({ delay: 100 })
	await sidebar.getByTestId("provider-option-openrouter").click({ delay: 100 })

	const apiKeyInput = sidebar.getByRole("textbox", {
		name: "API Key",
	})
	await apiKeyInput.fill("test-api-key")
	await sidebar.getByRole("button", { name: "Continue" }).click()

	await expect(sidebar.getByTestId("chat-input")).toBeVisible()
}

async function openApiSettings(sidebar: Frame) {
	await sidebar.getByTitle("Open API Settings").click()
	await expect(sidebar.getByTestId("tab-api-config")).toBeVisible()
	await expect(sidebar.getByTestId("provider-selector-input")).toBeVisible()
}

async function selectProvider(sidebar: Frame, providerId: string) {
	const providerSelectorInput = sidebar.getByTestId("provider-selector-input")
	await providerSelectorInput.click({ delay: 100 })
	const option = sidebar.getByTestId(`provider-option-${providerId}`)
	await expect(option, `provider option ${providerId}`).toBeVisible({ timeout: 10_000 })
	const selectedLabel = (await option.textContent())?.trim()
	await option.click()
	if (selectedLabel) {
		await expect(providerSelectorInput).toHaveJSProperty("value", selectedLabel, { timeout: 10_000 })
	}
}

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
		name: "API Key",
	})
	await apiKeyInput.fill("test-api-key")
	await expect(apiKeyInput).toHaveValue("test-api-key")
	await apiKeyInput.click({ delay: 100 })
	await sidebar.getByRole("button", { name: "Continue" }).click()

	await expect(sidebar.getByRole("button", { name: "Login to Cline" })).not.toBeVisible()

	// Verify start up page is no longer visible
	await expect(apiKeyInput).not.toBeVisible()
	await expect(providerSelectorInput).not.toBeVisible()

	// Verify you are now in the chat page after setup was completed.
	// cline logo container
	const clineLogo = sidebar.locator(".size-20")
	await expect(clineLogo).toBeVisible()
	const chatInputBox = sidebar.getByTestId("chat-input")
	await expect(chatInputBox).toBeVisible()
})

e2e("Settings - renders SDK provider config fields from the provider catalog", async ({ sidebar }, testInfo) => {
	testInfo.setTimeout(60_000)

	await completeBringYourOwnKeyOnboarding(sidebar)
	await openApiSettings(sidebar)

	await selectProvider(sidebar, "bedrock")

	await expect(sidebar.getByText("Authentication", { exact: true })).toBeVisible()
	await expect(sidebar.getByText("AWS Region", { exact: true })).toBeVisible()
	await expect(sidebar.getByText("Base Inference Model", { exact: true })).toBeVisible()
	await expect(sidebar.getByText("Global Inference", { exact: true })).toBeVisible()

	await selectProvider(sidebar, "openai")
	await expect(sidebar.getByText("API Key", { exact: true })).toBeVisible()
	await expect(sidebar.getByText("Base URL", { exact: true })).toBeVisible()
	await expect(sidebar.getByText("Azure API Version", { exact: true })).toBeVisible()
	await expect(sidebar.getByText("Headers", { exact: true })).toBeVisible()

	await selectProvider(sidebar, "sapaicore")
	await expect(sidebar.getByText("Base URL", { exact: true })).toBeVisible()
	await expect(sidebar.getByText("Client ID", { exact: true })).toBeVisible()
	await expect(sidebar.getByText("Client Secret", { exact: true })).toBeVisible()
	await expect(sidebar.getByText("Token URL", { exact: true })).toBeVisible()
	await expect(sidebar.getByText("Resource Group", { exact: true })).toBeVisible()
	await expect(sidebar.getByText("Deployment ID", { exact: true })).toBeVisible()
	await expect(sidebar.getByText("Use Orchestration API", { exact: true })).toBeVisible()

	for (const providerId of ["ollama", "lmstudio", "litellm"]) {
		await selectProvider(sidebar, providerId)
		await expect(sidebar.getByText("API Key", { exact: true })).toBeVisible()
		await expect(sidebar.getByText("Base URL", { exact: true })).toBeVisible()
	}

	await selectProvider(sidebar, "oca")
	await expect(sidebar.getByText("I’m an Oracle Employee", { exact: true })).toBeVisible()
	await expect(sidebar.getByRole("button", { name: "Sign in with Oracle Code Assist" })).toBeVisible()
	await expect(sidebar.getByText("Prompt Cache", { exact: true })).toBeVisible()
	await expect(sidebar.getByRole("textbox", { name: "API Key" })).not.toBeVisible()
})

e2e("Settings - exposes supported SDK providers in the catalog dropdown", async ({ sidebar }, testInfo) => {
	testInfo.setTimeout(120_000)

	await completeBringYourOwnKeyOnboarding(sidebar)
	await openApiSettings(sidebar)

	await sidebar.getByTestId("provider-selector-input").click({ delay: 100 })
	await expect(sidebar.getByTestId("provider-option-cline")).toContainText("(OAuth)")
	await expect(sidebar.getByTestId("provider-option-openai-codex")).toContainText("(OAuth)")
	await expect(sidebar.getByTestId("provider-option-oca")).toContainText("(OAuth)")

	const apiKeyAndBaseUrlProviders = [
		"anthropic",
		"openrouter",
		"gemini",
		"openai-native",
		"requesty",
		"together",
		"deepseek",
		"qwen",
		"doubao",
		"mistral",
		"litellm",
		"moonshot",
		"huggingface",
		"nebius",
		"fireworks",
		"asksage",
		"xai",
		"sambanova",
		"cerebras",
		"groq",
		"baseten",
		"vercel-ai-gateway",
		"zai",
		"aihubmix",
		"minimax",
		"hicap",
		"nousResearch",
		"wandb",
		"poolside",
		"v0",
		"huawei-cloud-maas",
		"zai-coding-plan",
		"xiaomi",
		"kilo",
		"ollama",
		"lmstudio",
	]

	for (const providerId of apiKeyAndBaseUrlProviders) {
		await selectProvider(sidebar, providerId)
		await expect(sidebar.getByText("API Key", { exact: true })).toBeVisible()
		await expect(sidebar.getByText("Base URL", { exact: true })).toBeVisible()
		await expect(sidebar.getByLabel("Model").first()).toBeVisible()
	}

	await selectProvider(sidebar, "vertex")
	await expect(sidebar.getByText("Google Cloud Project ID", { exact: true })).toBeVisible()
	await expect(sidebar.getByText("Vertex Region", { exact: true })).toBeVisible()
	await expect(sidebar.getByText("API Key", { exact: true })).toBeVisible()
	await expect(sidebar.getByLabel("Model").first()).toBeVisible()

	await selectProvider(sidebar, "bedrock")
	await expect(sidebar.getByText("Authentication", { exact: true })).toBeVisible()
	await expect(sidebar.getByText("AWS Region", { exact: true })).toBeVisible()
	await expect(sidebar.getByText("Base Inference Model", { exact: true })).toBeVisible()
	await expect(sidebar.getByLabel("Model").first()).toBeVisible()

	await selectProvider(sidebar, "sapaicore")
	await expect(sidebar.getByText("Resource Group", { exact: true })).toBeVisible()
	await expect(sidebar.getByText("Deployment ID", { exact: true })).toBeVisible()
	await expect(sidebar.getByLabel("Model").first()).toBeVisible()

	await selectProvider(sidebar, "oca")
	await expect(sidebar.getByRole("button", { name: "Sign in with Oracle Code Assist" })).toBeVisible()
	await expect(sidebar.getByText("Prompt Cache", { exact: true })).toBeVisible()

	await sidebar.getByTestId("provider-selector-input").click({ delay: 100 })
	await expect(sidebar.getByTestId("provider-option-claude-code")).not.toBeVisible()
	await expect(sidebar.getByTestId("provider-option-qwen-code")).not.toBeVisible()
	await expect(sidebar.getByTestId("provider-option-dify")).not.toBeVisible()
})

e2e("Settings - persists SDK provider field edits through provider config", async ({ sidebar }, testInfo) => {
	testInfo.setTimeout(60_000)

	await completeBringYourOwnKeyOnboarding(sidebar)
	await openApiSettings(sidebar)

	await selectProvider(sidebar, "openai")
	const openAiBaseUrl = sidebar.getByRole("textbox", { name: "Base URL" })
	await openAiBaseUrl.fill("https://azure.example.test/openai")
	const azureApiVersion = sidebar.getByRole("textbox", { name: "Azure API Version" })
	await azureApiVersion.fill("2025-01-01-preview")
	const headers = sidebar.getByRole("textbox", { name: "Headers" })
	await headers.fill('{"x-ms-client-request-id":"cline-e2e"}')

	await selectProvider(sidebar, "sapaicore")
	const sapBaseUrl = sidebar.getByRole("textbox", { name: "Base URL" })
	await sapBaseUrl.fill("https://sap.example.test")

	await selectProvider(sidebar, "openai")
	await expect(sidebar.getByRole("textbox", { name: "Base URL" })).toHaveValue("https://azure.example.test/openai")
	await expect(sidebar.getByRole("textbox", { name: "Azure API Version" })).toHaveValue("2025-01-01-preview")
	await expect(sidebar.getByRole("textbox", { name: "Headers" })).toHaveValue('{"x-ms-client-request-id":"cline-e2e"}')

	await selectProvider(sidebar, "sapaicore")
	await expect(sidebar.getByRole("textbox", { name: "Base URL" })).toHaveValue("https://sap.example.test")
})
