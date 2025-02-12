import { ExtensionContext } from "vscode"
import { refreshCursorToken } from "../../../../webview-ui/src/utils/cursor/auth"
import { CursorConfig } from "../../../shared/config/cursor"
import { Logger } from "../../../services/logging/Logger"
import crypto from "crypto"

export class CursorTokenError extends Error {
	constructor(
		message: string,
		public readonly type: "expired" | "invalid" | "network" | "storage" | "unknown" = "unknown",
		public readonly shouldLogout: boolean = false,
		public readonly details?: unknown,
	) {
		super(message)
		this.name = "CursorTokenError"
		Object.setPrototypeOf(this, CursorTokenError.prototype)
	}
}

interface TokenState {
	accessToken: string
	refreshToken: string
	expiryTime: number
}

export class CursorTokenManager {
	private tokenState: TokenState | null = null
	private refreshPromise: Promise<void> | null = null
	private clientKey: string

	constructor(private readonly context: ExtensionContext) {
		this.clientKey = this.generateClientKey()
		this.initializeConfig()
		this.loadTokenState()
	}

	private log(message: string, error?: Error | unknown) {
		const timestamp = new Date().toISOString()
		if (error) {
			Logger.log(`[CURSOR TOKEN ${timestamp}] ${message}: ${error instanceof Error ? error.stack : String(error)}`)
		} else {
			Logger.log(`[CURSOR TOKEN ${timestamp}] ${message}`)
		}
	}

	private generateClientKey(): string {
		const uuid = crypto.randomUUID()
		return crypto.createHash("sha256").update(uuid).digest("hex")
	}

	private initializeConfig(): void {
		;(CursorConfig as any).CLIENT_KEY = this.clientKey
	}

	public getClientKey(): string {
		return this.clientKey
	}

	private async loadTokenState(): Promise<void> {
		try {
			const [accessToken, refreshToken] = await Promise.all([
				this.context.secrets.get(CursorConfig.STORAGE_KEYS.ACCESS_TOKEN),
				this.context.secrets.get(CursorConfig.STORAGE_KEYS.REFRESH_TOKEN),
			])

			if (accessToken && refreshToken) {
				this.tokenState = {
					accessToken,
					refreshToken,
					expiryTime: Date.now() + CursorConfig.TOKEN_VALIDITY,
				}
				this.log("Token state loaded successfully")
			} else {
				this.log("No existing tokens found in storage")
			}
		} catch (error) {
			this.log("Failed to load token state", error)
			this.tokenState = null
			throw new CursorTokenError("Failed to load token state", "storage", false, error)
		}
	}

	private async saveTokenState(): Promise<void> {
		try {
			if (this.tokenState) {
				await Promise.all([
					this.context.secrets.store(CursorConfig.STORAGE_KEYS.ACCESS_TOKEN, this.tokenState.accessToken),
					this.context.secrets.store(CursorConfig.STORAGE_KEYS.REFRESH_TOKEN, this.tokenState.refreshToken),
				])
				this.log("Token state saved successfully")
			} else {
				await this.clearTokenState()
			}
		} catch (error) {
			this.log("Failed to save token state", error)
			throw new CursorTokenError("Failed to save token state", "storage", false, error)
		}
	}

	private async clearTokenState(): Promise<void> {
		try {
			await Promise.all([
				this.context.secrets.delete(CursorConfig.STORAGE_KEYS.ACCESS_TOKEN),
				this.context.secrets.delete(CursorConfig.STORAGE_KEYS.REFRESH_TOKEN),
			])
			this.tokenState = null
			this.log("Token state cleared successfully")
		} catch (error) {
			this.log("Failed to clear token state", error)
			// Don't throw here as this is cleanup
		}
	}

	public async setTokens(accessToken: string, refreshToken: string): Promise<void> {
		this.tokenState = {
			accessToken,
			refreshToken,
			expiryTime: Date.now() + CursorConfig.TOKEN_VALIDITY,
		}
		await this.saveTokenState()
		this.log("New tokens set successfully")
	}

	public async getAccessToken(): Promise<string> {
		if (!this.tokenState) {
			this.log("No token available")
			throw new CursorTokenError("No token available", "expired", true)
		}

		const timeUntilExpiry = this.tokenState.expiryTime - Date.now()

		// If token is expired, throw error
		if (timeUntilExpiry <= 0) {
			this.log("Token expired")
			throw new CursorTokenError("Token expired", "expired", true)
		}

		// If token needs refresh
		if (timeUntilExpiry <= CursorConfig.TOKEN_REFRESH_THRESHOLD) {
			this.log("Token requires refresh")
			await this.refreshToken()
		}

		return this.tokenState.accessToken
	}

	private async refreshToken(): Promise<void> {
		// If already refreshing, wait for that to complete
		if (this.refreshPromise) {
			this.log("Token refresh already in progress, waiting...")
			await this.refreshPromise
			return
		}

		if (!this.tokenState?.refreshToken) {
			this.log("No refresh token available")
			throw new CursorTokenError("No refresh token available", "expired", true)
		}

		try {
			this.refreshPromise = (async () => {
				this.log("Starting token refresh")
				const { access_token } = await refreshCursorToken(this.tokenState!.refreshToken)

				this.tokenState = {
					accessToken: access_token,
					refreshToken: this.tokenState!.refreshToken,
					expiryTime: Date.now() + CursorConfig.TOKEN_VALIDITY,
				}

				await this.saveTokenState()
				this.log("Token refresh completed successfully")
			})()

			await this.refreshPromise
		} catch (error) {
			const message = error instanceof Error ? error.message : "Failed to refresh token"
			this.log("Token refresh failed", error)

			// Determine error type based on error details
			let errorType: "network" | "invalid" | "unknown" = "unknown"
			if (error instanceof Error) {
				if (error.message.includes("network") || error.message.includes("timeout")) {
					errorType = "network"
				} else if (error.message.includes("invalid") || error.message.includes("expired")) {
					errorType = "invalid"
				}
			}

			throw new CursorTokenError(message, errorType, errorType === "invalid", error)
		} finally {
			this.refreshPromise = null
		}
	}

	public async clearTokens(): Promise<void> {
		await this.clearTokenState()
	}

	public isAuthenticated(): boolean {
		return this.tokenState !== null
	}
}
