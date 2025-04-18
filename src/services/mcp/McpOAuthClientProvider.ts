import * as vscode from "vscode"
import { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js"
import {
	OAuthClientInformation,
	OAuthClientInformationFull,
	OAuthTokens,
	OAuthClientMetadata,
} from "@modelcontextprotocol/sdk/shared/auth.js"
import { OAuthProviderOptions } from "@shared/mcp"
import { getServerAuthHash } from "@utils/mcpAuth"
import { randomBytes } from "crypto"
import { OAuthLogger, maskUrl } from "@services/logging/OAuthLogger"

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
	private async _saveState(state: string): Promise<boolean> {
		const stateSaved = await this.saveToStorage("oauth-state", state)
		const timestampSaved = await this.saveToStorage("oauth-state-ts", Date.now().toString())
		return stateSaved && timestampSaved
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

		const stateCleared = await this.saveToStorage("oauth-state", "")
		const timestampCleared = await this.saveToStorage("oauth-state-ts", "")
		if (!stateCleared || !timestampCleared) {
			OAuthLogger.logError(this.serverName, "state_cleanup", "Failed to clear state after validation")
			// Not returning false here as validation itself was successful
		}

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
		if (!stored) {
			return undefined
		}

		try {
			return JSON.parse(stored) as OAuthClientInformation
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			OAuthLogger.logError(
				this.serverName,
				"client_info_parse_error",
				`Failed to parse client information: ${errorMessage}`,
			)
			return undefined
		}
	}

	async saveClientInformation(clientInformation: OAuthClientInformationFull): Promise<void> {
		const saved = await this.saveToStorage("client-info", JSON.stringify(clientInformation))
		if (!saved) {
			OAuthLogger.logError(this.serverName, "client_info_save_failed", "Failed to save client information")
			vscode.window.showErrorMessage(
				`Failed to save client information for ${this.serverName}. The MCP server connection may not work properly.`,
			)
		}
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

		try {
			const tokens = JSON.parse(stored) as OAuthTokens

			try {
				const savedAt = parseInt(storedTimestamp, 10)
				if (isNaN(savedAt)) {
					OAuthLogger.logError(this.serverName, "token_timestamp_invalid", "Stored timestamp is not a valid number")
					return undefined
				}

				const expiresInMs = (tokens.expires_in || 3_600) * 1_000

				if (savedAt + expiresInMs < Date.now()) {
					const tokenAge = Math.floor((Date.now() - savedAt) / 1_000)
					OAuthLogger.logInfo(this.serverName, "token_expired", { age_seconds: tokenAge })
					return undefined
				}
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error)
				OAuthLogger.logError(this.serverName, "token_timestamp_parse_error", `Failed to parse timestamp: ${errorMessage}`)
				return undefined
			}

			return tokens
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			OAuthLogger.logError(this.serverName, "token_parse_error", `Failed to parse tokens: ${errorMessage}`)
			return undefined
		}
	}

	async saveTokens(tokens: OAuthTokens): Promise<void> {
		const tokensSaved = await this.saveToStorage("tokens", JSON.stringify(tokens))
		const timestampSaved = await this.saveToStorage("tokens-saved-at", Date.now().toString())

		if (tokensSaved && timestampSaved) {
			OAuthLogger.logInfo(this.serverName, "token_acquired", {
				expires_in: tokens.expires_in || 3_600,
				has_refresh_token: Boolean(tokens.refresh_token),
			})
		} else {
			OAuthLogger.logError(this.serverName, "token_save_failed", "Failed to save complete token information")
			vscode.window.showErrorMessage(
				`Failed to save authentication tokens for ${this.serverName}. You may need to re-authenticate.`,
			)
		}
	}

	/**
	 * Checks if the current session is authenticated with valid tokens
	 * @returns Promise resolving to true if authenticated, false otherwise
	 */
	async isAuthenticated(): Promise<boolean> {
		const tokens = await this.tokens()
		const isAuth = Boolean(tokens && tokens.access_token)

		if (isAuth) {
			OAuthLogger.logInfo(this.serverName, "authentication_check_success", {
				has_access_token: Boolean(tokens?.access_token),
				has_refresh_token: Boolean(tokens?.refresh_token),
			})
		} else {
			OAuthLogger.logInfo(this.serverName, "authentication_check_failed", { reason: "No valid tokens found" })
		}

		return isAuth
	}

	async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
		const state = this._generateState()
		const stateSaved = await this._saveState(state)

		if (!stateSaved) {
			OAuthLogger.logError(
				this.serverName,
				"authorization_state_save_failed",
				"Failed to save state parameter, authorization may fail",
			)
			vscode.window.showWarningMessage(
				`Failed to properly secure the authorization process for ${this.serverName}. The authorization may fail or be insecure.`,
				{ modal: true },
			)
			// Proceeding anyway to give it a chance to work, but with a warning to the user
		}

		authorizationUrl.searchParams.set("state", state)

		OAuthLogger.logInfo(this.serverName, "authorization_started", {
			url: maskUrl(authorizationUrl.toString()),
			callback: this.callbackPath,
		})

		try {
			await vscode.env.openExternal(vscode.Uri.parse(authorizationUrl.toString()))
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			OAuthLogger.logError(
				this.serverName,
				"authorization_browser_error",
				`Failed to open browser for authorization: ${errorMessage}`,
			)
			vscode.window.showErrorMessage(
				`Failed to open browser for ${this.serverName} authorization. Please try again or check your system configuration.`,
			)
		}
	}

	async saveCodeVerifier(codeVerifier: string): Promise<void> {
		const saved = await this.saveToStorage("code-verifier", codeVerifier)
		if (!saved) {
			OAuthLogger.logError(this.serverName, "code_verifier_save_failed", "Failed to save code verifier")
			vscode.window.showErrorMessage(
				`Failed to save authentication data for ${this.serverName}. The authorization process may fail.`,
			)
		}
	}

	async codeVerifier(): Promise<string> {
		const verifier = await this.getFromStorage("code-verifier")
		if (!verifier) {
			throw new Error("No code verifier found. Authorization flow may have been interrupted.")
		}
		return verifier
	}

	private async getFromStorage(key: string): Promise<string | undefined> {
		try {
			const result = await vscode.commands.executeCommand("cline.getSecret", `${this.storagePrefix}-${key}`)
			return result as string | undefined
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			OAuthLogger.logError(this.serverName, "storage_read_error", `Failed to read ${key} from storage: ${errorMessage}`)
			return undefined
		}
	}

	private async saveToStorage(key: string, value: string): Promise<boolean> {
		try {
			await vscode.commands.executeCommand("cline.saveSecret", `${this.storagePrefix}-${key}`, value)
			return true
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error)
			OAuthLogger.logError(this.serverName, "storage_write_error", `Failed to save ${key} to storage: ${errorMessage}`)

			// Notify the user for critical storage operations
			if (key.includes("tokens") || key.includes("client-info")) {
				vscode.window.showErrorMessage(
					`Failed to save authentication data for ${this.serverName}. The MCP server connection may not work properly.`,
				)
			}
			return false
		}
	}
}
