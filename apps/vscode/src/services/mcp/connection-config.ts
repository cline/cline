import deepEqual from "fast-deep-equal"
import type { McpServerConfig } from "./types"

const REDACTED_MCP_CONFIG_VALUE = "<redacted>"

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

function flattenRawServerConfig(rawConfig: unknown): Record<string, unknown> | undefined {
	if (!isRecord(rawConfig)) {
		return undefined
	}
	return isRecord(rawConfig.transport) ? { ...rawConfig, ...rawConfig.transport } : rawConfig
}

function sanitizeDisplayUrl(value: unknown): string {
	if (typeof value !== "string" || value.includes("${env:")) {
		return REDACTED_MCP_CONFIG_VALUE
	}
	try {
		const url = new URL(value)
		if (!url.username && !url.password && !url.search && !url.hash) {
			// Preserve an exact safe raw URL; normalization can break callers that
			// compare a remote-managed URL string byte-for-byte.
			return value
		}
		url.username = ""
		url.password = ""
		url.search = ""
		url.hash = ""
		return url.toString()
	} catch {
		return REDACTED_MCP_CONFIG_VALUE
	}
}

/**
 * Produces the only MCP config representation allowed to leave the extension
 * host. OAuth state is private, static client secrets are omitted, and values
 * that may have been expanded from environment variables are redacted.
 */
export function serializeMcpServerConfigForDisplay(config: McpServerConfig, rawConfig?: unknown): string {
	const {
		oauth: _oauth,
		oauthClient,
		metadata: _metadata,
		...publicConfig
	} = config as McpServerConfig & {
		oauth?: unknown
		metadata?: unknown
	}
	const redactedConfig: Record<string, unknown> = { ...publicConfig }
	// Raw provenance is retained only inside the extension host. It lets us
	// distinguish a literal safe URL from an effective URL that may contain an
	// environment-expanded secret; without it the only safe display is redaction.
	const raw = flattenRawServerConfig(rawConfig)

	if (config.type === "stdio") {
		redactedConfig.command = REDACTED_MCP_CONFIG_VALUE
		if (config.args) {
			redactedConfig.args = config.args.map(() => REDACTED_MCP_CONFIG_VALUE)
		}
		if (config.cwd) {
			redactedConfig.cwd = REDACTED_MCP_CONFIG_VALUE
		}
	} else {
		// Effective config may already contain an expanded secret in any URL
		// component. Without raw provenance there is no safe substring to expose.
		redactedConfig.url = raw ? sanitizeDisplayUrl(raw.url) : REDACTED_MCP_CONFIG_VALUE
	}

	if ("headers" in config && config.headers) {
		redactedConfig.headers = Object.fromEntries(Object.keys(config.headers).map((name) => [name, REDACTED_MCP_CONFIG_VALUE]))
	}
	if ("env" in config && config.env) {
		redactedConfig.env = Object.fromEntries(Object.keys(config.env).map((name) => [name, REDACTED_MCP_CONFIG_VALUE]))
	}
	if (oauthClient) {
		const { clientSecret: _clientSecret, ...publicOAuthClient } = oauthClient
		redactedConfig.oauthClient = publicOAuthClient
	}

	return JSON.stringify(redactedConfig)
}

/** Connection-relevant comparison used by settings reconciliation. */
export function configsRequireMcpRestart(oldConfig: McpServerConfig, newConfig: McpServerConfig): boolean {
	// OAuth handshake state changes frequently and is consumed through fresh
	// bound reads. Static oauthClient policy remains in the comparison because a
	// changed client/scope/loopback policy must replace the provider.
	const {
		autoApprove: _oldAutoApprove,
		remoteConfigured: _oldRemoteConfigured,
		oauth: _oldOauth,
		metadata: _oldMetadata,
		...oldConnectionConfig
	} = oldConfig as McpServerConfig & { oauth?: unknown; metadata?: unknown }
	const {
		autoApprove: _newAutoApprove,
		remoteConfigured: _newRemoteConfigured,
		oauth: _newOauth,
		metadata: _newMetadata,
		...newConnectionConfig
	} = newConfig as McpServerConfig & { oauth?: unknown; metadata?: unknown }
	return !deepEqual(oldConnectionConfig, newConnectionConfig)
}

/** Stable watcher fingerprint for connection configuration and token presence. */
export function computeMcpConnectionFingerprint(mcpServers: Record<string, McpServerConfig>): string {
	const normalized: Record<string, unknown> = {}
	for (const name of Object.keys(mcpServers).sort()) {
		const { oauth, ...connectionConfig } = mcpServers[name] as McpServerConfig & {
			oauth?: { tokens?: { access_token?: unknown } }
		}
		const accessToken = oauth?.tokens?.access_token
		normalized[name] = {
			config: connectionConfig,
			// Token bytes and refresh churn are deliberately excluded. Presence alone
			// is enough to reconnect when another process grants or revokes access while
			// avoiding a watcher loop for every token rewrite.
			hasToken: typeof accessToken === "string" && accessToken.length > 0,
		}
	}
	return JSON.stringify(normalized)
}
