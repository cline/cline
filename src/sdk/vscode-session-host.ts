// VscodeSessionHost — wraps DefaultSessionManager with VSCode-specific customizations
//
// Replaces ClineCore.create() with direct DefaultSessionManager construction,
// allowing us to pass custom runtimeBuilder, oauthTokenManager, and other options
// that ClineCore.create() doesn't expose.
//
// Key customizations (see PROBLEMS.md S6-9 for full rationale):
// 1. VscodeRuntimeBuilder — bridges classic McpHub to SDK tool system
// 2. VscodeOAuthTokenManager — reads OAuth tokens from secrets.json instead
//    of ProviderSettingsManager, preventing "Run 'clite auth'" error messages
// 3. source: "vscode" — tags sessions for telemetry instead of default "cli"
// 4. requestToolApproval — VSCode approval UI integration (future)

import {
	type CoreSessionEvent,
	DefaultSessionManager,
	refreshClineToken,
	resolveSessionBackend,
	type SendSessionInput,
	type SessionAccumulatedUsage,
	type SessionManager,
	type SessionRecord,
	type StartSessionInput,
	type StartSessionResult,
} from "@clinebot/core"
import { isOAuthProviderId, type OAuthProviderId, type ToolApprovalRequest, type ToolApprovalResult } from "@clinebot/shared"
import { writeFileSync } from "fs"
import { join } from "path"
import { ClineEnv } from "@/config"
import { StateManager } from "@/core/storage/StateManager"
import type { McpHub } from "@/services/mcp/McpHub"
import { Logger } from "@/shared/services/Logger"
import { resolveDataDir } from "./legacy-state-reader"
import { VscodeRuntimeBuilder } from "./vscode-runtime-builder"

// ---------------------------------------------------------------------------
// Types (not exported from @clinebot/core's main entry)
// ---------------------------------------------------------------------------

/**
 * Result of OAuth token resolution.
 * Mirrors the SDK's RuntimeOAuthResolution type from
 * packages/core/src/session/runtime-oauth-token-manager.ts
 */
interface VscodeOAuthResolution {
	providerId: OAuthProviderId
	apiKey: string
	accountId?: string
	refreshed: boolean
}

// ---------------------------------------------------------------------------
// VscodeOAuthTokenManager
// ---------------------------------------------------------------------------

const CLINE_AUTH_SECRET_KEY = "cline:clineAccountId"
const WORKOS_TOKEN_PREFIX = "workos:"

/**
 * Custom OAuth token manager that reads credentials from the VSCode extension's
 * secrets.json storage instead of the SDK's ProviderSettingsManager.
 *
 * This prevents the "Run 'clite auth <provider>' and retry" error message that
 * the SDK's default RuntimeOAuthTokenManager throws when OAuth re-auth is needed.
 * Instead, we return null on failure, which causes the SDK to skip the OAuth
 * sync and let the auth error propagate naturally to the user.
 *
 * For non-cline OAuth providers (openai-codex, oca), we delegate to the SDK's
 * built-in RuntimeOAuthTokenManager which reads from ProviderSettingsManager —
 * this is correct because we save those credentials to providers.json via the
 * auth service.
 *
 * NOTE: We use `as any` when passing this to DefaultSessionManager because
 * RuntimeOAuthTokenManager is a class (not an interface) with private members,
 * and it's not exported from @clinebot/core's main entry point. The only method
 * that DefaultSessionManager actually calls is `resolveProviderApiKey()`, which
 * our class provides with a compatible signature.
 */
class VscodeOAuthTokenManager {
	async resolveProviderApiKey(input: { providerId: string; forceRefresh?: boolean }): Promise<VscodeOAuthResolution | null> {
		if (!isOAuthProviderId(input.providerId)) {
			return null
		}

		const providerId = input.providerId as OAuthProviderId

		try {
			if (providerId === "cline") {
				return await this.resolveClineToken(input.forceRefresh)
			}

			// For other OAuth providers (openai-codex, oca), read credentials
			// from the SDK's ProviderSettingsManager (providers.json).
			// These are stored there by the auth service's saveCodexCredentials().
			return await this.resolveNonClineToken(providerId)
		} catch (error) {
			// Catch OAuthReauthRequiredError and return null instead of throwing.
			// This prevents the "Run 'clite auth' and retry" error message that
			// DefaultSessionManager.syncOAuthCredentials() would produce.
			if (error instanceof Error && error.name === "OAuthReauthRequiredError") {
				Logger.warn(
					`[VscodeOAuthTokenManager] OAuth re-auth required for ${providerId}. ` +
						"User needs to log in again via the extension UI.",
				)
				return null
			}
			throw error
		}
	}

	/**
	 * Resolve the Cline provider's OAuth token from secrets.json.
	 *
	 * Reads the `cline:clineAccountId` secret, extracts the idToken,
	 * and returns it with the `workos:` prefix (matching the classic
	 * AuthService.getAuthToken() behavior).
	 *
	 * If the token is expired or about to expire, attempts to refresh it
	 * using the SDK's `refreshClineToken()`. If refresh fails, returns null
	 * (instead of throwing OAuthReauthRequiredError).
	 */
	private async resolveClineToken(forceRefresh?: boolean): Promise<VscodeOAuthResolution | null> {
		try {
			const stateManager = StateManager.get()
			const raw = stateManager.getSecretKey(CLINE_AUTH_SECRET_KEY)
			if (!raw) return null

			const authInfo = JSON.parse(raw) as {
				idToken?: string
				refreshToken?: string
				expiresAt?: number // seconds since epoch
				userInfo?: { id?: string }
			}

			if (!authInfo.idToken) return null

			let accessToken = authInfo.idToken
			let wasRefreshed = false

			// Check if token needs refresh
			const expiresAt = authInfo.expiresAt
			const needsRefresh = forceRefresh || (expiresAt ? Date.now() / 1000 + 300 >= expiresAt : false)

			if (needsRefresh && authInfo.refreshToken) {
				try {
					const apiBaseUrl = ClineEnv.config().apiBaseUrl
					const newCredentials = await refreshClineToken(
						{
							access: accessToken,
							refresh: authInfo.refreshToken,
							expires: expiresAt ? expiresAt * 1000 : 0,
							accountId: authInfo.userInfo?.id,
						},
						{ apiBaseUrl },
					)

					// Update the stored auth info
					accessToken = newCredentials.access
					wasRefreshed = true

					// Persist the refreshed token back to secrets.json
					const updatedAuthInfo = {
						...authInfo,
						idToken: newCredentials.access,
						refreshToken: newCredentials.refresh,
						expiresAt: newCredentials.expires ? newCredentials.expires / 1000 : undefined,
					}
					stateManager.setSecret(CLINE_AUTH_SECRET_KEY, JSON.stringify(updatedAuthInfo))

					Logger.log("[VscodeOAuthTokenManager] Refreshed Cline OAuth token")
				} catch (error) {
					Logger.warn("[VscodeOAuthTokenManager] Token refresh failed:", error)
					// If force refresh was requested and failed, return null
					// to signal that credentials are no longer valid
					if (forceRefresh) return null
					// Otherwise, try using the existing (possibly expired) token
					// The API call will fail and the user will see an auth error
				}
			}

			const apiKey = `${WORKOS_TOKEN_PREFIX}${accessToken}`
			return {
				providerId: "cline",
				apiKey,
				accountId: authInfo.userInfo?.id,
				refreshed: wasRefreshed,
			}
		} catch (error) {
			Logger.error("[VscodeOAuthTokenManager] Failed to resolve Cline token:", error)
			return null
		}
	}

	/**
	 * Resolve non-cline OAuth provider tokens from the SDK's ProviderSettingsManager.
	 *
	 * For providers like openai-codex and oca, the auth service stores credentials
	 * in the SDK's providers.json via ProviderSettingsManager. We read from there.
	 *
	 * If credentials aren't found or are invalid, returns null (instead of
	 * throwing OAuthReauthRequiredError).
	 */
	private async resolveNonClineToken(providerId: OAuthProviderId): Promise<VscodeOAuthResolution | null> {
		try {
			const { ProviderSettingsManager } = await import("@clinebot/core")
			const dataDir = resolveDataDir()
			const manager = new ProviderSettingsManager({ dataDir })
			const settings = manager.getProviderSettings(providerId)

			if (!settings?.auth?.accessToken) {
				return null
			}

			return {
				providerId,
				apiKey: settings.auth.accessToken,
				accountId: settings.auth.accountId,
				refreshed: false,
			}
		} catch (error) {
			Logger.warn(`[VscodeOAuthTokenManager] Failed to resolve ${providerId} token:`, error)
			return null
		}
	}
}

// ---------------------------------------------------------------------------
// VscodeSessionHost
// ---------------------------------------------------------------------------

export interface VscodeSessionHostOptions {
	/** The classic McpHub for MCP tool bridging */
	mcpHub: McpHub
	/** Optional tool approval callback for VSCode approval UI integration */
	requestToolApproval?: (request: {
		agentId: string
		conversationId: string
		iteration: number
		toolCallId: string
		toolName: string
		input: unknown
		policy: { enabled: boolean; autoApprove: boolean }
	}) => Promise<{ approved: boolean; reason?: string }>
}

/**
 * VSCode-specific SessionManager that wraps DefaultSessionManager with
 * custom runtime builder, OAuth token manager, and session source tagging.
 *
 * This replaces ClineCore.create() with direct DefaultSessionManager construction,
 * giving us control over:
 * - runtimeBuilder: Uses VscodeRuntimeBuilder to bridge classic McpHub
 * - oauthTokenManager: Reads OAuth tokens from secrets.json
 * - source: Tags sessions as "vscode" for telemetry
 * - requestToolApproval: VSCode approval UI integration (future)
 *
 * Usage:
 * ```ts
 * const host = await VscodeSessionHost.create({ mcpHub })
 * const result = await host.start({ config, prompt, interactive: true })
 * const unsub = host.subscribe((event) => { ... })
 * ```
 */
export class VscodeSessionHost implements SessionManager {
	private inner!: DefaultSessionManager

	private constructor() {}

	/**
	 * Create a VscodeSessionHost with custom options.
	 *
	 * This resolves the session backend (local SQLite/file storage),
	 * creates the VscodeRuntimeBuilder and VscodeOAuthTokenManager,
	 * and constructs the DefaultSessionManager with all custom options.
	 */
	static async create(options: VscodeSessionHostOptions): Promise<VscodeSessionHost> {
		const host = new VscodeSessionHost()

		// Ensure MCP settings are filtered for the SDK's default builder.
		// The VscodeRuntimeBuilder delegates to DefaultRuntimeBuilder for builtin
		// tools, which calls loadConfiguredMcpTools(). We point it to an empty
		// settings file so it loads no MCP tools — the VscodeRuntimeBuilder
		// replaces them with tools from the classic McpHub.
		await ensureEmptyMcpSettings()

		// Resolve session backend (local mode — SQLite with file fallback)
		const sessionService = await resolveSessionBackend({ backendMode: "local" })

		// Create custom runtime builder that bridges classic McpHub
		const runtimeBuilder = new VscodeRuntimeBuilder(options.mcpHub)

		// Create custom OAuth token manager
		const oauthTokenManager = new VscodeOAuthTokenManager()

		// Construct DefaultSessionManager with custom options.
		// NOTE: oauthTokenManager is cast to `any` because RuntimeOAuthTokenManager
		// is a class (not an interface) with private members that isn't exported
		// from @clinebot/core's main entry. DefaultSessionManager only calls
		// `resolveProviderApiKey()` on it, which our class provides.
		// biome-ignore lint/suspicious/noExplicitAny: RuntimeOAuthTokenManager is a class with private members not exported from @clinebot/core — duck-typing is the only option
		host.inner = new DefaultSessionManager({
			sessionService,
			runtimeBuilder,
			oauthTokenManager: oauthTokenManager as any,
			requestToolApproval: options.requestToolApproval as
				| ((request: ToolApprovalRequest) => Promise<ToolApprovalResult>)
				| undefined,
			distinctId: "cline-vscode",
		})

		Logger.log("[VscodeSessionHost] Initialized with VscodeRuntimeBuilder + VscodeOAuthTokenManager")
		return host
	}

	// ---- SessionManager implementation ----

	async start(input: StartSessionInput): Promise<StartSessionResult> {
		// Inject source: "vscode" for telemetry (SDK defaults to "cli")
		const modifiedInput: StartSessionInput = {
			...input,
			source: input.source ?? "vscode",
		}
		return this.inner.start(modifiedInput)
	}

	async send(input: SendSessionInput) {
		return this.inner.send(input)
	}

	async getAccumulatedUsage(sessionId: string): Promise<SessionAccumulatedUsage | undefined> {
		return this.inner.getAccumulatedUsage(sessionId)
	}

	async abort(sessionId: string, reason?: unknown): Promise<void> {
		return this.inner.abort(sessionId, reason)
	}

	async stop(sessionId: string): Promise<void> {
		return this.inner.stop(sessionId)
	}

	async dispose(reason?: string): Promise<void> {
		return this.inner.dispose(reason)
	}

	async get(sessionId: string): Promise<SessionRecord | undefined> {
		return this.inner.get(sessionId)
	}

	async list(limit?: number): Promise<SessionRecord[]> {
		return this.inner.list(limit)
	}

	async delete(sessionId: string): Promise<boolean> {
		return this.inner.delete(sessionId)
	}

	async readMessages(sessionId: string) {
		return this.inner.readMessages(sessionId)
	}

	async readTranscript(sessionId: string, maxChars?: number): Promise<string> {
		return this.inner.readTranscript(sessionId, maxChars)
	}

	async readHooks(sessionId: string, limit?: number): Promise<unknown[]> {
		return this.inner.readHooks(sessionId, limit)
	}

	subscribe(listener: (event: CoreSessionEvent) => void): () => void {
		return this.inner.subscribe(listener)
	}
}

// ---------------------------------------------------------------------------
// MCP settings helpers
// ---------------------------------------------------------------------------

/**
 * Write an empty MCP settings file and point the SDK to it.
 *
 * The VscodeRuntimeBuilder delegates to DefaultRuntimeBuilder for builtin
 * tools, which calls loadConfiguredMcpTools(). This function reads from
 * CLINE_MCP_SETTINGS_PATH. By pointing it to an empty settings file, we
 * ensure the default builder loads no MCP tools — the VscodeRuntimeBuilder
 * replaces them with tools from the classic McpHub which supports all
 * transport types (stdio, SSE, streamableHttp).
 */
async function ensureEmptyMcpSettings(): Promise<void> {
	try {
		const dataDir = resolveDataDir()
		const settingsDir = join(dataDir, "settings")

		// Ensure the settings directory exists
		const { mkdirSync } = await import("fs")
		mkdirSync(settingsDir, { recursive: true })

		// Write an empty MCP settings file
		const emptyPath = join(settingsDir, "cline_mcp_settings_empty.json")
		writeFileSync(emptyPath, JSON.stringify({ mcpServers: {} }))

		// Point the SDK to the empty settings file
		process.env.CLINE_MCP_SETTINGS_PATH = emptyPath

		Logger.log(`[VscodeSessionHost] Empty MCP settings: ${emptyPath}`)
	} catch (error) {
		Logger.warn("[VscodeSessionHost] Failed to create empty MCP settings:", error)
	}
}
