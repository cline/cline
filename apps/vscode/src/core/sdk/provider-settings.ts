// Single shared ProviderSettingsManager for the SDK-backed extension.
//
// The SDK's ProviderSettingsManager is the single source of truth for provider credentials
// (it reads/writes ~/.cline/data/settings/providers.json — the same file ClineCore reads when
// it boots). Both the AuthService (which persists the signed-in Cline access token) and
// session-config (which resolves the cline provider's apiKey for an outgoing LLM call) must use
// the SAME manager instance/path so the token written at sign-in is the token read at send time.
//
// Constructed lazily with the SDK default path so we never throw during activation.

import { ProviderSettingsManager } from "@cline/core"
import { Logger } from "@shared/services/Logger"

let _manager: ProviderSettingsManager | undefined

/**
 * Returns the process-wide ProviderSettingsManager, creating it on first use.
 * Uses the SDK default providers.json path (~/.cline/data/settings/providers.json), which is the
 * same path ClineCore resolves, so credentials written here are visible to the SDK runtime.
 */
export function getProviderSettingsManager(): ProviderSettingsManager {
	if (!_manager) {
		_manager = new ProviderSettingsManager()
		Logger.log("[ProviderSettings] ProviderSettingsManager initialized")
	}
	return _manager
}
