// Computes whether the active mode has a usable provider, using the same
// resolution path as buildSessionConfig (providers.json + ApiConfiguration).
// No legacy state-key heuristics.
//
// "Usable" mirrors what buildSessionConfig can actually turn into a working
// session: if we can resolve a credential (BYOK key or OAuth auth token) for
// the active-mode provider, the user can chat. Keyless providers (SDK
// "local-auth" providers and the local-inference providers
// ollama/lmstudio/vscode-lm) are usable once a model is configured, even
// without an API key. Vertex can also be usable without a Gemini API key when
// Google Cloud project/region are configured and Application Default Credentials
// are available at request time.

import { getProviderConfigFields } from "@cline/core"
import type { ApiConfiguration } from "@shared/api"
import { Logger } from "@shared/services/Logger"
import type { Mode } from "@shared/storage/types"
import { StateManager } from "@/core/storage/StateManager"
import { resolveBedrockAuthentication } from "./bedrock-config"
import { resolveApiKey, resolveModelId, resolveVertexProviderConfig } from "./cline-session-factory"
import { toSdkProviderId } from "./model-catalog/sdk-provider-id"
import { getProviderSettingsManager } from "./provider-migration"

/**
 * Local/external-auth providers that the legacy ApiConfiguration path treats as
 * keyless: they need no API key in Cline, only a selected model (and optionally
 * a base URL). The SDK catalog models ollama/lmstudio as "api-key" providers
 * because they accept an optional key; Claude Code authenticates through the
 * local Claude CLI; and `vscode-lm` is a VSCode-host provider that is not in
 * the SDK builtin catalog at all. List them here when the catalog auth method
 * cannot classify them as keyless.
 */
const KEYLESS_LOCAL_PROVIDERS = new Set<string>(["ollama", "lmstudio", "vscode-lm", "claude-code"])

/**
 * Whether a provider can be usable WITHOUT an API key, on the strength of a
 * configured model alone (local-inference / local-auth providers).
 *
 * IMPORTANT: OAuth providers (cline, oca, openai-codex) are deliberately NOT
 * included here. They require an actual credential — for `cline` that is the
 * OAuth token in providers.json, resolved by resolveApiKey(). Treating them as
 * "usable because a model is selected" would let an unauthenticated Cline user
 * bypass the gate (the Cline provider always has a default model preselected),
 * which is precisely the case scenario #3 must block.
 *
 * Sourced from the SDK provider catalog where possible:
 * - `getProviderConfigFields(id).authMethod === "local"` → SDK `local-auth`
 *   providers (e.g. openai-codex-cli).
 * - Plus the local-inference providers in {@link KEYLESS_LOCAL_PROVIDERS}
 *   (ollama/lmstudio/vscode-lm), which the SDK catalog models as optional-key
 *   "api-key" providers but which run keyless against a local endpoint.
 *
 * Keeps the keyless set catalog-driven instead of a hardcoded list of every
 * provider, matching how the rest of the SDK adapter classifies providers.
 */
function getProviderAuthMethod(providerId: string): string | undefined {
	try {
		return getProviderConfigFields(toSdkProviderId(providerId)).authMethod
	} catch {
		return undefined
	}
}

function isKeylessViaModelProvider(providerId: string): boolean {
	if (KEYLESS_LOCAL_PROVIDERS.has(providerId)) {
		return true
	}
	return getProviderAuthMethod(providerId) === "local"
}

function readProviderSettings(providerId: string): unknown {
	try {
		return getProviderSettingsManager().getProviderSettings(providerId)
	} catch {
		Logger.warn(`[ProviderUsability] Failed to read provider settings for provider ${providerId}`)
		return undefined
	}
}

function hasProviderSettingsAuthCredential(providerId: string): boolean {
	const settings = readProviderSettings(providerId)
	const auth = settings && typeof settings === "object" ? (settings as { auth?: { accessToken?: unknown } }).auth : undefined
	return typeof auth?.accessToken === "string" && auth.accessToken.trim().length > 0
}

function readProviderSettingsModelId(providerId: string): string | undefined {
	const settings = readProviderSettings(providerId)
	const model = settings && typeof settings === "object" ? (settings as { model?: unknown }).model : undefined
	return typeof model === "string" && model.trim().length > 0 ? model.trim() : undefined
}

function resolveConfiguredModelId(providerId: string, mode: Mode, apiConfig: ApiConfiguration): string | undefined {
	return resolveModelId(providerId, mode, apiConfig) ?? readProviderSettingsModelId(providerId)
}

/**
 * Whether the Bedrock provider has usable auth. resolveApiKey() only sees the
 * Bedrock API key; profile / SigV4 / default-chain auth also build a working
 * session, so classify per resolved auth mode (kept in sync with
 * buildBedrockProviderConfig).
 */
function hasUsableVertexAuth(apiConfig: ApiConfiguration): boolean {
	const config = resolveVertexProviderConfig(apiConfig)
	return Boolean(config.gcp?.projectId?.trim() && (config.gcp.region?.trim() || config.region?.trim()))
}

function hasUsableBedrockAuth(apiConfig: ApiConfiguration): boolean {
	const authentication = resolveBedrockAuthentication(apiConfig)
	switch (authentication) {
		case "apikey":
		case "api-key": {
			const apiKey = apiConfig.awsBedrockApiKey
			return typeof apiKey === "string" && apiKey.trim().length > 0
		}
		// profile / iam: SigV4, a profile, or the default credential chain;
		// all resolve at request time, so treat as usable.
		case "profile":
		case "iam":
			return true
		default:
			return false
	}
}

/**
 * Compute whether the active mode's provider has a usable credential/config.
 *
 * Decoupled from the StateManager singleton so it can be unit-tested with a
 * plain ApiConfiguration + mode.
 */
export function hasUsableProvider(apiConfig: ApiConfiguration, mode: Mode): boolean {
	const providerId = mode === "plan" ? apiConfig.planModeApiProvider : apiConfig.actModeApiProvider

	// No provider selected for the active mode -> cannot chat.
	if (!providerId) {
		return false
	}

	// resolveApiKey() only covers Bedrock's API-key auth; handle its other
	// auth modes before the generic key check below.
	if (providerId === "bedrock") {
		return hasUsableBedrockAuth(apiConfig)
	}

	// A resolvable credential (BYOK key, Bedrock key, or OAuth token)
	// means we can build a session and chat.
	const apiKey = resolveApiKey(providerId, apiConfig)
	if (typeof apiKey === "string" && apiKey.trim().length > 0) {
		return true
	}

	// Vertex Anthropic models use Google Cloud ADC rather than a Gemini API key.
	// If project/region are configured, the actual ADC resolution happens at
	// request time just like Bedrock's IAM/default-chain auth.
	if (providerId === "vertex" && hasUsableVertexAuth(apiConfig)) {
		return true
	}

	// OAuth-backed providers such as OpenAI Codex store subscription credentials
	// in providers.json as `settings.auth.accessToken`; they do not necessarily
	// project that token into ApiConfiguration, so resolve the auth envelope
	// directly through the shared provider settings store.
	if (hasProviderSettingsAuthCredential(providerId)) {
		return true
	}

	// Keyless local/local-auth providers are usable once a model is
	// configured for the mode (no API key required).
	if (isKeylessViaModelProvider(providerId)) {
		const modelId = resolveConfiguredModelId(providerId, mode, apiConfig)
		return typeof modelId === "string" && modelId.trim().length > 0
	}

	return false
}

/**
 * Convenience wrapper that reads the current ApiConfiguration and mode from
 * StateManager. Synchronous and cheap — safe to call inside
 * getStateToPostToWebview().
 */
export function hasUsableProviderForActiveMode(): boolean {
	try {
		const stateManager = StateManager.get()
		const apiConfig = stateManager.getApiConfiguration()
		const mode: Mode = stateManager.getGlobalSettingsKey("mode") ?? "act"
		return hasUsableProvider(apiConfig, mode)
	} catch (error) {
		Logger.warn("[ProviderUsability] Failed to compute usable provider:", error)
		// Fail open: do not gate the UI on an internal read error.
		return true
	}
}
