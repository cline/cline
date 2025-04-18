import * as vscode from "vscode"
import { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js"
import {
	OAuthClientInformation,
	OAuthClientInformationFull,
	OAuthTokens,
	OAuthClientMetadata,
} from "@modelcontextprotocol/sdk/shared/auth.js"
import { OAuthProviderOptions } from "../../shared/mcp.js"
import { getServerAuthHash } from "../../shared/utils.js"
import { randomBytes } from "crypto"
import { OAuthLogger, maskUrl } from "../../services/logging/OAuthLogger"

export class McpOAuthClientProvider implements OAuthClientProvider {
	private callbackPath: string
	private serverUrl: string
	private serverName: string
	private clientName: string
	private clientUri: string
	private softwareId: string
	private softwareVersion: string
	private readonly storagePrefix: string

	constructor(readonly options: OAuthProviderOptions) {
		this.callbackPath = options.callbackPath
		this.serverUrl = options.serverUrl
		this.serverName = options.serverName
		this.clientName = options.clientName
		this.clientUri = options.clientUri
		this.softwareId = options.softwareId
		this.softwareVersion = options.softwareVersion

		// Create unique storage keys for this server
		const serverHash = getServerAuthHash(this.serverName, this.serverUrl)
		this.storagePrefix = `mcp-oauth-${serverHash}`
	}

	/**
	 * Generates a random state parameter
	 */
	private _generateState(): string {
		return randomBytes(32).toString("hex")
	}

	/**
	 * Stores the state parameter for later validation
	 */
	private async _saveState(state: string): Promise<void> {
		await this.saveToStorage("oauth-state", state)
		await this.saveToStorage("oauth-state-ts", Date.now().toString())
	}

	/**
	 * Validates the state parameter and checks expiration
	 */
	public async validateState(state: string): Promise<boolean> {
		const storedState = await this.getFromStorage("oauth-state")
		const storedTimeStamp = await this.getFromStorage("oauth-state-ts")
		if (!storedState || !storedTimeStamp) {
			OAuthLogger.logError(this.serverName, "state_validation", "Missing stored state")
			vscode.window.showWarningMessage(
				`The authorization state for the ${this.serverName} MCP server is missing. Please try again.`,
				{ modal: true },
			)
			return false
		}
		const now = Date.now()
		const storedTimestampEpochMs = parseInt(storedTimeStamp, 10)
		const expirationMs = 10 * 60 * 1_000

		if (state !== storedState) {
			OAuthLogger.logError(this.serverName, "state_validation", "State mismatch")
			vscode.window.showWarningMessage(
				`The authorization state for the ${this.serverName} MCP server is invalid. Please try again.`,
				{ modal: true },
			)
			return false
		}

		if (now - storedTimestampEpochMs > expirationMs) {
			OAuthLogger.logError(this.serverName, "state_validation", "State expired")
			vscode.window.showWarningMessage(
				`The authorization state for the ${this.serverName} MCP server has expired. Please try again.`,
				{ modal: true },
			)
			return false
		}

		await this.saveToStorage("oauth-state", "")
		await this.saveToStorage("oauth-state-ts", "")

		OAuthLogger.logInfo(this.serverName, "state_validation_success")
		return true
	}
	get redirectUrl(): string | URL {
		const baseCallbackUrl = `vscode://${this.clientName}`
		return new URL(`${baseCallbackUrl}${this.callbackPath}`)
	}
	get clientMetadata(): OAuthClientMetadata {
		return {
			client_name: this.clientName,
			client_uri: this.clientUri,
			software_id: this.softwareId,
			software_version: this.softwareVersion,
			redirect_uris: [this.redirectUrl.toString()],
			response_types: ["code"],
			grant_types: ["authorization_code", "refresh_token"],
			token_endpoint_auth_method: "none",
			scope: "openid profile",
		}
	}
	async clientInformation(): Promise<OAuthClientInformation | undefined> {
		const stored = await this.getFromStorage("client-info")
		return stored ? JSON.parse(stored) : undefined
	}

	async saveClientInformation(clientInformation: OAuthClientInformationFull): Promise<void> {
		await this.saveToStorage("client-info", JSON.stringify(clientInformation))
	}

	async tokens(): Promise<OAuthTokens | undefined> {
		const stored = await this.getFromStorage("tokens")
		if (!stored) {
			return undefined
		}
		const storedTimestamp = await this.getFromStorage("tokens-saved-at")
		if (!storedTimestamp) {
			return undefined
		}

		const tokens = JSON.parse(stored) as OAuthTokens
		const savedAt = parseInt(storedTimestamp, 10)
		const expiresInMs = (tokens.expires_in || 3_600) * 1_000

		if (savedAt + expiresInMs < Date.now()) {
			const tokenAge = Math.floor((Date.now() - savedAt) / 1_000)
			OAuthLogger.logInfo(this.serverName, "token_expired", { age_seconds: tokenAge })
			return undefined
		}

		return tokens
	}

	async saveTokens(tokens: OAuthTokens): Promise<void> {
		await this.saveToStorage("tokens", JSON.stringify(tokens))
		await this.saveToStorage("tokens-saved-at", Date.now().toString())

		OAuthLogger.logInfo(this.serverName, "token_acquired", {
			expires_in: tokens.expires_in || 3_600,
			has_refresh_token: Boolean(tokens.refresh_token),
		})
	}

	async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
		const state = this._generateState()
		await this._saveState(state)

		authorizationUrl.searchParams.set("state", state)

		OAuthLogger.logInfo(this.serverName, "authorization_started", {
			url: maskUrl(authorizationUrl.toString()),
			callback: this.callbackPath,
		})
		await vscode.env.openExternal(vscode.Uri.parse(authorizationUrl.toString()))
	}

	async saveCodeVerifier(codeVerifier: string): Promise<void> {
		await this.saveToStorage("code-verifier", codeVerifier)
	}

	async codeVerifier(): Promise<string> {
		const verifier = await this.getFromStorage("code-verifier")
		if (!verifier) {
			throw new Error("No code verifier found. Authorization flow may have been interrupted.")
		}
		return verifier
	}

	private async getFromStorage(key: string): Promise<string | undefined> {
		return await vscode.commands.executeCommand("cline.getSecret", `${this.storagePrefix}-${key}`)
	}

	private async saveToStorage(key: string, value: string): Promise<void> {
		await vscode.commands.executeCommand("cline.saveSecret", `${this.storagePrefix}-${key}`, value)
	}
}
