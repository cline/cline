// MCP OAuth state is stored in the shared MCP settings file
// (~/.cline/data/settings/cline_mcp_settings.json) under each server's `oauth`
// key, in the format @cline/core (CLI, JetBrains) reads and writes:
//
//   { "mcpServers": { "linear": { "transport": {...}, "oauth": { "tokens": {...}, ... } } } }
//
// This shared file is the single source of truth, which keeps the extension,
// the CLI, and multiple extension windows interoperable:
//  - Writes are a scoped read-modify-write of ONE server's `oauth` key via
//    @cline/core's updateMcpServerOAuthState, which re-reads the file on every
//    write and replaces it atomically (temp + rename). Concurrent writers from
//    other processes therefore never clobber other servers or the whole file.
//  - Reads come fresh from disk, so a token authorized by the CLI or another
//    window is picked up without restarting.
//  - The interactive authorization flow is HTTP-based token collection via
//    @cline/core's authorizeMcpServerOAuth, which binds a local loopback
//    callback server — the same flow the CLI uses.

import {
	authorizeMcpServerOAuth,
	getMcpServerOAuthState,
	type McpServerOAuthState,
	updateMcpServerOAuthState,
} from "@cline/core"
import { StateManager } from "@core/storage/StateManager"
import { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js"
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js"
import crypto from "crypto"
import { fetch } from "@/shared/net"
import { Logger } from "@/shared/services/Logger"
import { openExternal } from "@/utils/env"
import { getServerAuthHash } from "@/utils/mcpAuth"

/**
 * Fallback redirect URL advertised in client metadata for connection-time
 * providers. Matches @cline/core's DEFAULT_HTTP_MCP_REDIRECT_URL — the actual
 * redirect URL used during an interactive flow is chosen by
 * authorizeMcpServerOAuth when it binds its local callback server.
 */
const DEFAULT_HTTP_MCP_REDIRECT_URL = "http://127.0.0.1:1456/mcp/oauth/callback"

/**
 * Ports the local OAuth callback server may bind. The first three match the
 * @cline/core defaults; extras tolerate concurrent flows from other Cline
 * processes (CLI, another extension window) holding a port.
 */
const MCP_OAUTH_CALLBACK_PORTS = [1456, 1457, 1458, 1459, 1460, 1461]

/** How long the interactive flow waits for the browser callback. */
const MCP_OAUTH_FLOW_TIMEOUT_MS = 10 * 60 * 1000 // 10 minutes

/**
 * Read a server's OAuth state fresh from the shared settings file.
 * Never throws — a missing/unreadable file simply means "no state".
 */
function readOAuthState(serverName: string, settingsPath: string): McpServerOAuthState {
	try {
		return getMcpServerOAuthState(serverName, { filePath: settingsPath }) ?? {}
	} catch {
		return {}
	}
}

/**
 * Scoped write of one server's OAuth state. Re-reads the file inside
 * updateMcpServerOAuthState so concurrent writers (CLI, other windows) are
 * never clobbered wholesale. Failures are logged but non-fatal: a missing
 * server entry (e.g., just deleted in another window) shouldn't crash the
 * provider callbacks the MCP SDK invokes mid-connection.
 *
 * The underlying read-modify-write is intentionally SYNCHRONOUS. Multiple
 * processes (CLI, JetBrains, other windows) share this file, and within this
 * process the synchronous read+write+rename cannot be interleaved by another
 * OAuth callback, the settings watcher, or a toggle RPC — it acts as a
 * process-local mutex and guarantees this window never clobbers its own
 * in-flight update. The cost is a few small, blocking file operations during
 * an interactive auth handshake (a moment the user spends in the browser); we
 * accept that to keep the shared-file updates conflict-free. Switching to async
 * I/O would reintroduce the interleaving and require a Promise queue purely to
 * recover the serialization we get here for free.
 */
function patchOAuthState(
	serverName: string,
	settingsPath: string,
	updater: (current: McpServerOAuthState) => McpServerOAuthState,
): void {
	try {
		updateMcpServerOAuthState(serverName, updater, { filePath: settingsPath })
	} catch (error) {
		Logger.warn(`[McpOAuth] Failed to persist OAuth state for ${serverName}: ${error}`)
	}
}

/**
 * Implementation of OAuthClientProvider for connection-time auth.
 *
 * This provider is attached to SSE/StreamableHTTP transports so the MCP SDK
 * can read tokens (and auto-refresh them with the stored refresh_token). It
 * reads/writes the shared settings file in @cline/core's format.
 *
 * Note: `redirectToAuthorization` here is a no-op signal — connection attempts
 * never open a browser. The interactive flow (Authenticate button) goes
 * through McpOAuthManager.startOAuthFlow → authorizeMcpServerOAuth, which
 * runs its own provider with a live local callback server.
 */
class ClineOAuthClientProvider implements OAuthClientProvider {
	constructor(
		private readonly serverName: string,
		private readonly settingsPath: string,
	) {}

	get redirectUrl(): string {
		const state = readOAuthState(this.serverName, this.settingsPath)
		return state.redirectUrl ?? DEFAULT_HTTP_MCP_REDIRECT_URL
	}

	get clientMetadata(): OAuthClientMetadata {
		return {
			redirect_uris: [this.redirectUrl],
			token_endpoint_auth_method: "none",
			grant_types: ["authorization_code", "refresh_token"],
			response_types: ["code"],
			client_name: "Cline",
		}
	}

	state(): string {
		return crypto.randomUUID()
	}

	async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
		const state = readOAuthState(this.serverName, this.settingsPath)
		return state.clientInformation as OAuthClientInformationMixed | undefined
	}

	async saveClientInformation(clientInformation: OAuthClientInformationMixed): Promise<void> {
		patchOAuthState(this.serverName, this.settingsPath, (current) => ({
			...current,
			clientInformation: clientInformation as Record<string, unknown>,
		}))
	}

	async tokens(): Promise<OAuthTokens | undefined> {
		// Always read fresh from disk: tokens may have just been written by the
		// CLI, another extension window, or the interactive authorize flow.
		// Expired access tokens are still returned when a refresh_token exists —
		// the MCP SDK refreshes them automatically and calls saveTokens().
		const state = readOAuthState(this.serverName, this.settingsPath)
		return state.tokens as OAuthTokens | undefined
	}

	async saveTokens(tokens: OAuthTokens): Promise<void> {
		// Called by the SDK after a successful token exchange or refresh.
		Logger.log(`[McpOAuth] Tokens saved for ${this.serverName}`)
		patchOAuthState(this.serverName, this.settingsPath, (current) => ({
			...current,
			tokens: tokens as Record<string, unknown>,
			lastError: undefined,
			lastAuthenticatedAt: Date.now(),
		}))
	}

	async redirectToAuthorization(_authorizationUrl: URL): Promise<void> {
		// Intentionally do nothing. The SDK calls this during a connection
		// attempt when the server requires auth; it then throws
		// UnauthorizedError, which McpHub catches to show the "Authenticate"
		// button. The actual browser flow runs in startOAuthFlow(), with a
		// dedicated provider whose local callback server is actually listening.
		Logger.log(`[McpOAuth] OAuth required for ${this.serverName} - user must click Authenticate`)
	}

	async saveCodeVerifier(codeVerifier: string): Promise<void> {
		patchOAuthState(this.serverName, this.settingsPath, (current) => ({
			...current,
			codeVerifier,
		}))
	}

	async codeVerifier(): Promise<string> {
		const state = readOAuthState(this.serverName, this.settingsPath)
		if (!state.codeVerifier) {
			throw new Error(`No code verifier found for ${this.serverName}`)
		}
		return state.codeVerifier
	}

	async invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier"): Promise<void> {
		patchOAuthState(this.serverName, this.settingsPath, (current) => {
			if (scope === "all") {
				return { lastError: current.lastError, redirectUrl: current.redirectUrl }
			}
			return {
				...current,
				...(scope === "client" ? { clientInformation: undefined } : {}),
				...(scope === "tokens" ? { tokens: undefined, lastAuthenticatedAt: undefined } : {}),
				...(scope === "verifier" ? { codeVerifier: undefined } : {}),
			}
		})
	}

	/**
	 * Check if provider has valid authentication
	 */
	async isAuthenticated(): Promise<boolean> {
		const tokens = await this.tokens()
		return Boolean(tokens && tokens.access_token)
	}
}

/**
 * Manages OAuth authentication for MCP servers.
 *
 * Creates connection-time OAuthClientProvider instances (token reads/refresh
 * writes against the shared settings file) and runs the interactive
 * HTTP-callback authorization flow via @cline/core.
 */
export class McpOAuthManager {
	private providers: Map<string, OAuthClientProvider> = new Map()
	/** Serializes interactive flows per server so double-clicks don't race. */
	private activeFlows: Map<string, Promise<void>> = new Map()

	constructor(private readonly getSettingsPath: () => Promise<string>) {}

	/**
	 * Gets or creates an OAuthClientProvider for a server.
	 */
	async getOrCreateProvider(serverName: string, serverUrl: string): Promise<OAuthClientProvider> {
		const key = `${serverName}:${serverUrl}`
		const existing = this.providers.get(key)
		if (existing) {
			return existing
		}
		// Import tokens from the legacy `mcpOAuthSecrets` store into the shared
		// settings file before the first read, if any are present.
		await this.migrateLegacySecrets(serverName, serverUrl)
		const provider = new ClineOAuthClientProvider(serverName, await this.getSettingsPath())
		this.providers.set(key, provider)
		return provider
	}

	/**
	 * Runs the interactive OAuth flow when the user clicks "Authenticate".
	 *
	 * Delegates to @cline/core's authorizeMcpServerOAuth (the exact flow the
	 * CLI uses): binds a local loopback callback server, performs discovery and
	 * client registration, opens the browser, validates the returned state
	 * in-process, exchanges the code, and writes tokens to the shared settings
	 * file. Resolves when tokens are saved (or rejects on timeout/denial).
	 */
	async startOAuthFlow(serverName: string): Promise<void> {
		const inFlight = this.activeFlows.get(serverName)
		if (inFlight) {
			Logger.log(`[McpOAuth] OAuth flow already in progress for ${serverName}`)
			return inFlight
		}

		const flow = (async () => {
			const settingsPath = await this.getSettingsPath()
			const result = await authorizeMcpServerOAuth({
				serverName,
				filePath: settingsPath,
				clientName: "Cline",
				fetch,
				openUrl: (url) => openExternal(url),
				callbackPorts: MCP_OAUTH_CALLBACK_PORTS,
				timeoutMs: MCP_OAUTH_FLOW_TIMEOUT_MS,
			})
			Logger.log(`[McpOAuth] ${result.message}`)
		})()

		this.activeFlows.set(serverName, flow)
		try {
			await flow
		} finally {
			this.activeFlows.delete(serverName)
		}
	}

	/**
	 * Clears all OAuth data for a server (used when server is deleted).
	 * Tokens live in the server's own settings entry, so deleting the entry
	 * removes them; this also drops the cached provider and proactively
	 * clears the oauth block in case the entry itself is kept.
	 */
	async clearServerAuth(serverName: string, serverUrl: string): Promise<void> {
		this.providers.delete(`${serverName}:${serverUrl}`)
		patchOAuthState(serverName, await this.getSettingsPath(), () => ({}))
	}

	/**
	 * One-time migration of tokens from the legacy `mcpOAuthSecrets` secrets
	 * blob into the shared settings file. Runs per server at connection time;
	 * file-based state always wins (never overwrite newer shared state).
	 */
	private async migrateLegacySecrets(serverName: string, serverUrl: string): Promise<void> {
		try {
			const secretsJson = StateManager.get().getSecretKey("mcpOAuthSecrets")
			if (!secretsJson) {
				return
			}
			const secrets = JSON.parse(secretsJson) as Record<
				string,
				{ tokens?: OAuthTokens; tokens_saved_at?: number; client_info?: Record<string, unknown> }
			>
			const serverHash = getServerAuthHash(serverName, serverUrl)
			const legacy = secrets[serverHash]
			if (!legacy?.tokens?.access_token) {
				return
			}

			const settingsPath = await this.getSettingsPath()
			const current = readOAuthState(serverName, settingsPath)
			if (!current.tokens) {
				Logger.log(`[McpOAuth] Migrating legacy OAuth tokens for ${serverName} to shared settings file`)
				patchOAuthState(serverName, settingsPath, (state) => ({
					...state,
					tokens: legacy.tokens as unknown as Record<string, unknown>,
					clientInformation: state.clientInformation ?? legacy.client_info,
					lastAuthenticatedAt: legacy.tokens_saved_at ?? Date.now(),
				}))
			}

			// Drop the migrated entry so this only happens once per server.
			delete secrets[serverHash]
			StateManager.get().setSecret("mcpOAuthSecrets", Object.keys(secrets).length ? JSON.stringify(secrets) : undefined)
		} catch (error) {
			Logger.warn(`[McpOAuth] Legacy OAuth migration failed for ${serverName}: ${error}`)
		}
	}
}
