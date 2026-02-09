import { StateManager } from "@/core/storage/StateManager"
import { ProviderToApiKeyMap } from "@/shared/storage"

/**
 * Check if the user has completed onboarding (has any provider configured).
 *
 * Uses `welcomeViewCompleted` as the single source of truth, matching the VS Code extension's approach.
 * If `welcomeViewCompleted` is undefined (first run), checks if ANY provider has credentials
 * and sets the flag accordingly.
 */
export async function isAuthConfigured(): Promise<boolean> {
	const stateManager = StateManager.get()

	// Check welcomeViewCompleted first - this is the single source of truth
	const welcomeViewCompleted = stateManager.getGlobalStateKey("welcomeViewCompleted")
	if (welcomeViewCompleted !== undefined) {
		return welcomeViewCompleted
	}

	// welcomeViewCompleted is undefined - run migration logic to check if ANY provider has credentials
	// This mirrors the extension's migrateWelcomeViewCompleted behavior
	const hasAnyAuth = await checkAnyProviderConfigured()

	// Set welcomeViewCompleted based on what we found
	stateManager.setGlobalState("welcomeViewCompleted", hasAnyAuth)
	await stateManager.flushPendingState()

	return hasAnyAuth
}

/**
 * Check if ANY provider has valid credentials configured.
 * Used for migration when welcomeViewCompleted is undefined.
 */
export async function checkAnyProviderConfigured(): Promise<boolean> {
	const stateManager = StateManager.get()
	const config = stateManager.getApiConfiguration() as Record<string, unknown>

	// Check Cline account (stored as "cline:clineAccountId" in secrets, loaded into config)
	if (config["clineApiKey"] || config["cline:clineAccountId"]) return true

	// Check OpenAI Codex OAuth (stored in SECRETS_KEYS, loaded into config)
	if (config["openai-codex-oauth-credentials"]) return true

	// Check all BYO provider API keys (loaded into config from secrets)
	for (const [provider, keyField] of Object.entries(ProviderToApiKeyMap)) {
		// Skip cline - already checked above with the correct key
		if (provider === "cline") continue

		const fields = Array.isArray(keyField) ? keyField : [keyField]
		for (const field of fields) {
			if (config[field]) return true
		}
	}

	// Check provider-specific settings that indicate configuration
	// (for providers that don't require API keys like Bedrock with IAM, Ollama, LM Studio)
	if (config.awsRegion) return true
	if (config.vertexProjectId) return true
	if (config.ollamaBaseUrl) return true
	if (config.lmStudioBaseUrl) return true

	return false
}
