// Maps the extension's legacy Claude Code ApiConfiguration onto the SDK's
// Claude Code provider options (pathToClaudeCodeExecutable).
//
// Both inference paths need this:
//   - buildSdkProviderConfig() in sdk-api-handler.ts (standalone utility calls)
//   - buildSessionConfig() in cline-session-factory.ts (main task loop)
//
// Without it, the SDK gateway never receives the user-configured Claude Code
// CLI path, so the provider falls back to PATH lookup which may not find it or
// may find the wrong version. On Windows, this causes spawn EINVAL errors when
// the path isn't properly passed through (see community.ts resolveClaudeExecutable).
//
// IMPORTANT: the provider-specific field on the SDK's public ProviderConfig is
// `claudeCode` (typed as `ClaudeCodeConfig`, a free-form `{[key: string]: unknown}`
// bag) -- NOT `options`. `ProviderConfig` has no `options` field at all; the
// internal gateway-resolved config (`GatewayResolvedProviderConfig`, used inside
// `createClaudeCodeProviderModule` in community.ts) is what exposes `.options`,
// and the SDK maps `ProviderConfig.claudeCode` onto that internal `.options`
// during gateway resolution. Setting `.options` directly here is a no-op: it
// isn't a key of the public type, so it's silently dropped before the gateway
// ever resolves it.

import type { ProviderConfig } from "@cline/llms"
import type { ApiConfiguration } from "@shared/api"

/** The Claude Code-specific subset of an SDK ProviderConfig. */
export type ClaudeCodeProviderConfig = Pick<ProviderConfig, "claudeCode">

function trimToUndefined(value: unknown): string | undefined {
	if (typeof value !== "string") {
		return undefined
	}
	const trimmed = value.trim()
	return trimmed.length > 0 ? trimmed : undefined
}

/**
 * Build the Claude Code `claudeCode` portion of the SDK ProviderConfig from the
 * extension's ApiConfiguration.
 *
 * This ensures the user-configured Claude Code CLI path (claudeCodePath) is
 * forwarded to the provider as `claudeCode.defaultSettings.pathToClaudeCodeExecutable`,
 * avoiding PATH lookups and spawn issues on Windows.
 */
export function buildClaudeCodeProviderConfig(configuration: ApiConfiguration): ClaudeCodeProviderConfig {
	const claudeCodePath = trimToUndefined(configuration.claudeCodePath)

	if (!claudeCodePath) {
		// No explicit path configured; let the provider use its default resolution.
		return {}
	}

	return {
		claudeCode: {
			defaultSettings: {
				pathToClaudeCodeExecutable: claudeCodePath,
			},
		},
	}
}
