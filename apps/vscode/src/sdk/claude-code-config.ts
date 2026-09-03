// Maps the extension's legacy `claudeCodePath` ApiConfiguration field onto the
// SDK's structured Claude Code provider options (ProviderConfig.claudeCode).
//
// The settings UI persists the executable path, but the SDK-era provider never
// read it (#11908). buildSessionConfig() and buildSdkProviderConfig() both use
// this mapper. The provider module only runs its own bundled/PATH resolution
// when pathToClaudeCodeExecutable is undefined, so emitting the key is what
// makes the configured path win -- and a blank setting must emit nothing.

import type { ProviderConfig } from "@cline/llms"
import type { ApiConfiguration } from "@shared/api"

export type ClaudeCodeProviderConfig = Pick<ProviderConfig, "claudeCode">

function trimString(value: unknown): string | undefined {
	if (typeof value !== "string") {
		return undefined
	}

	return value.trim()
}

export function buildClaudeCodeProviderConfig(config: ApiConfiguration): ClaudeCodeProviderConfig {
	const pathToClaudeCodeExecutable = trimString(config.claudeCodePath)

	// Unset or cleared-to-blank means "no override": leave the provider's own
	// bundled/PATH resolution untouched.
	if (pathToClaudeCodeExecutable === undefined || pathToClaudeCodeExecutable.length === 0) {
		return {}
	}

	return {
		claudeCode: {
			defaultSettings: { pathToClaudeCodeExecutable },
		},
	}
}
