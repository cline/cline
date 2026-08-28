import {
	authorizeMcpServerOAuth,
	createMcpOAuthClientInformation,
	createMcpOAuthClientPolicyBinding,
	createMcpOAuthProviderContext,
	createMcpOAuthTransportBinding,
	type McpServerOAuthClientConfig,
	type McpServerTransportConfig,
	resolveMcpServerRegistration,
	updateMcpServerOAuthStateAsync,
} from "@cline/core"
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js"
import { fetch } from "@/shared/net"
import { Logger } from "@/shared/services/Logger"
import { openExternal } from "@/utils/env"

export type McpOAuthRemoteTransport = Extract<McpServerTransportConfig, { url: string }>

export class McpOAuthEffectiveTransportMismatchError extends Error {
	constructor(serverName: string) {
		super(
			`MCP OAuth is unavailable for "${serverName}" because environment expansion changes its remote URL, headers, or OAuth client policy. Use literal remote URL, header, and OAuth client values so credentials stay bound to the configured endpoint and client.`,
		)
		this.name = "McpOAuthEffectiveTransportMismatchError"
	}
}

/**
 * Fallback redirect URL advertised in client metadata for connection-time
 * providers. Matches @cline/core's DEFAULT_HTTP_MCP_REDIRECT_URL — the actual
 * redirect URL used during an interactive flow is chosen by
 * authorizeMcpServerOAuth when it binds its local callback server.
 */
const DEFAULT_HTTP_MCP_REDIRECT_URL = "http://127.0.0.1:1456/mcp/oauth/callback"

/**
 * Ports the local OAuth callback server may bind. The first three match the
 * @cline/core defaults and the redirect URIs registered by every Cline setup
 * surface. Expanding this list requires updating those registrations first.
 */
export const MCP_OAUTH_CALLBACK_PORTS = [1456, 1457, 1458] as const

/** How long the interactive flow waits for the browser callback. */
const MCP_OAUTH_FLOW_TIMEOUT_MS = 10 * 60 * 1000 // 10 minutes

type CachedOAuthProvider = {
	transportBinding: string
	clientBinding: string
	provider: OAuthClientProvider
}

export interface McpOAuthManagerDependencies {
	authorizeMcpServerOAuth: typeof authorizeMcpServerOAuth
	createMcpOAuthClientInformation: typeof createMcpOAuthClientInformation
	createMcpOAuthClientPolicyBinding: typeof createMcpOAuthClientPolicyBinding
	createMcpOAuthProviderContext: typeof createMcpOAuthProviderContext
	createMcpOAuthTransportBinding: typeof createMcpOAuthTransportBinding
	resolveMcpServerRegistration: typeof resolveMcpServerRegistration
	updateMcpServerOAuthStateAsync: typeof updateMcpServerOAuthStateAsync
}

const defaultDependencies: McpOAuthManagerDependencies = {
	authorizeMcpServerOAuth,
	createMcpOAuthClientInformation,
	createMcpOAuthClientPolicyBinding,
	createMcpOAuthProviderContext,
	createMcpOAuthTransportBinding,
	resolveMcpServerRegistration,
	updateMcpServerOAuthStateAsync,
}

function resolveConnectionRedirectUrl(client: McpServerOAuthClientConfig | undefined): string {
	if (client?.loopbackHostname === "localhost") {
		return "http://localhost:1456/mcp/oauth/callback"
	}
	return DEFAULT_HTTP_MCP_REDIRECT_URL
}

/**
 * Manages OAuth authentication for MCP servers.
 *
 * Creates connection-time OAuthClientProvider instances (token reads/refresh
 * writes against the shared settings file) and runs the interactive
 * HTTP-callback authorization flow via @cline/core.
 */
export class McpOAuthManager {
	private providers = new Map<string, CachedOAuthProvider>()
	/** Serializes interactive flows per server so double-clicks don't race. */
	private activeFlows: Map<string, Promise<void>> = new Map()

	constructor(
		private readonly getSettingsPath: () => Promise<string>,
		private readonly dependencies: McpOAuthManagerDependencies = defaultDependencies,
	) {}

	/**
	 * Gets or creates an OAuthClientProvider for one exact remote transport.
	 *
	 * The shared Core context re-reads bound state for every credential access
	 * and guards every write under the settings lock. Replacing this cache entry
	 * when either the transport or static client changes prevents an old provider
	 * from surviving a settings edit. The effective client policy is compared
	 * against the raw registration so environment expansion also fails closed,
	 * while canonical header and scope ordering still reuse the same provider.
	 */
	async getOrCreateProvider(
		serverName: string,
		transport: McpOAuthRemoteTransport,
		effectiveOAuthClient: McpServerOAuthClientConfig | undefined,
		effectiveTransport: McpOAuthRemoteTransport = transport,
	): Promise<OAuthClientProvider> {
		const transportBinding = this.dependencies.createMcpOAuthTransportBinding(transport)
		if (this.dependencies.createMcpOAuthTransportBinding(effectiveTransport) !== transportBinding) {
			throw new McpOAuthEffectiveTransportMismatchError(serverName)
		}
		const settingsPath = await this.getSettingsPath()
		let registration: ReturnType<typeof resolveMcpServerRegistration>
		try {
			registration = this.dependencies.resolveMcpServerRegistration(serverName, { filePath: settingsPath })
		} catch {
			// VS Code supports expanding a complete remote URL from ${env:...}.
			// Core intentionally validates the raw persisted registration and rejects
			// that placeholder as a URL. Treat that as an unavailable binding rather
			// than failing an otherwise valid non-OAuth connection.
			throw new McpOAuthEffectiveTransportMismatchError(serverName)
		}
		const registrationTransportBinding =
			registration && registration.transport.type !== "stdio"
				? this.dependencies.createMcpOAuthTransportBinding(registration.transport)
				: undefined
		if (registrationTransportBinding !== transportBinding) {
			throw new McpOAuthEffectiveTransportMismatchError(serverName)
		}
		const oauthClient = registration?.oauthClient
		const clientBinding = this.dependencies.createMcpOAuthClientPolicyBinding(oauthClient)
		if (this.dependencies.createMcpOAuthClientPolicyBinding(effectiveOAuthClient) !== clientBinding) {
			throw new McpOAuthEffectiveTransportMismatchError(serverName)
		}
		const existing = this.providers.get(serverName)
		if (existing?.transportBinding === transportBinding && existing.clientBinding === clientBinding) {
			return existing.provider
		}

		const context = this.dependencies.createMcpOAuthProviderContext({
			settingsPath,
			serverName,
			transportBinding,
			redirectUrl: resolveConnectionRedirectUrl(oauthClient),
			clientInformation: this.dependencies.createMcpOAuthClientInformation(oauthClient),
			allowedScopes: oauthClient?.allowedScopes,
			loopbackHostname: oauthClient?.loopbackHostname,
			onAuthorizationUrl: () => {
				// Connection attempts only surface the Authenticate action. The
				// explicit interactive flow below owns browser navigation.
				Logger.log(`[McpOAuth] OAuth required for ${serverName} - user must click Authenticate`)
			},
		})
		const provider = context.provider
		this.providers.set(serverName, { transportBinding, clientBinding, provider })
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
			const result = await this.dependencies.authorizeMcpServerOAuth({
				serverName,
				filePath: settingsPath,
				clientName: "Cline",
				fetch,
				openUrl: (url) => openExternal(url),
				callbackPorts: [...MCP_OAUTH_CALLBACK_PORTS],
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
	async clearServerAuth(
		serverName: string,
		transport: McpOAuthRemoteTransport,
		oauthClient: McpServerOAuthClientConfig | undefined,
	): Promise<void> {
		this.providers.delete(serverName)
		const settingsPath = await this.getSettingsPath()
		const transportBinding = this.dependencies.createMcpOAuthTransportBinding(transport)
		try {
			await this.dependencies.updateMcpServerOAuthStateAsync(serverName, () => ({}), {
				filePath: settingsPath,
				expectedTransportBinding: transportBinding,
				expectedOAuthClient: oauthClient ?? null,
			})
		} catch (error) {
			// Deletion can race another window changing/removing this entry. The
			// guarded write must not clear credentials for the replacement target.
			Logger.warn(`[McpOAuth] Failed to clear OAuth state for ${serverName}: ${error}`)
		}
	}
}
