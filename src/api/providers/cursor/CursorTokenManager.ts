import { ExtensionContext } from "vscode"
import { refreshCursorToken } from "../../../../webview-ui/src/utils/cursor/auth"

export class CursorTokenError extends Error {
	constructor(
		message: string,
		public readonly type: "expired" | "invalid" | "network" | "unknown" = "unknown",
		public readonly shouldLogout: boolean = false,
	) {
		super(message)
		this.name = "CursorTokenError"
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
	private static readonly TOKEN_REFRESH_THRESHOLD = 300000 // 5 minutes in milliseconds
	private static readonly TOKEN_VALIDITY = 3600000 // 1 hour in milliseconds

	constructor(private readonly context: ExtensionContext) {
		this.loadTokenState()
	}

	private async loadTokenState(): Promise<void> {
		try {
			const [accessToken, refreshToken] = await Promise.all([
				this.context.secrets.get("cursorAccessToken"),
				this.context.secrets.get("cursorRefreshToken"),
			])

			if (accessToken && refreshToken) {
				this.tokenState = {
					accessToken,
					refreshToken,
					expiryTime: Date.now() + CursorTokenManager.TOKEN_VALIDITY,
				}
			}
		} catch (error) {
			console.error("Failed to load token state:", error)
			this.tokenState = null
		}
	}

	private async saveTokenState(): Promise<void> {
		try {
			if (this.tokenState) {
				await Promise.all([
					this.context.secrets.store("cursorAccessToken", this.tokenState.accessToken),
					this.context.secrets.store("cursorRefreshToken", this.tokenState.refreshToken),
				])
			} else {
				await this.clearTokenState()
			}
		} catch (error) {
			console.error("Failed to save token state:", error)
			throw new CursorTokenError("Failed to save token state", "unknown")
		}
	}

	private async clearTokenState(): Promise<void> {
		try {
			await Promise.all([
				this.context.secrets.delete("cursorAccessToken"),
				this.context.secrets.delete("cursorRefreshToken"),
			])
			this.tokenState = null
		} catch (error) {
			console.error("Failed to clear token state:", error)
		}
	}

	public async setTokens(accessToken: string, refreshToken: string): Promise<void> {
		this.tokenState = {
			accessToken,
			refreshToken,
			expiryTime: Date.now() + CursorTokenManager.TOKEN_VALIDITY,
		}
		await this.saveTokenState()
	}

	public async getAccessToken(): Promise<string> {
		if (!this.tokenState) {
			throw new CursorTokenError("No token available", "expired", true)
		}

		const timeUntilExpiry = this.tokenState.expiryTime - Date.now()

		// If token is expired, throw error
		if (timeUntilExpiry <= 0) {
			throw new CursorTokenError("Token expired", "expired", true)
		}

		// If token needs refresh
		if (timeUntilExpiry <= CursorTokenManager.TOKEN_REFRESH_THRESHOLD) {
			await this.refreshToken()
		}

		return this.tokenState.accessToken
	}

	private async refreshToken(): Promise<void> {
		// If already refreshing, wait for that to complete
		if (this.refreshPromise) {
			await this.refreshPromise
			return
		}

		if (!this.tokenState?.refreshToken) {
			throw new CursorTokenError("No refresh token available", "expired", true)
		}

		try {
			this.refreshPromise = (async () => {
				console.log("Refreshing Cursor token...")
				const { access_token } = await refreshCursorToken(this.tokenState!.refreshToken)

				this.tokenState = {
					accessToken: access_token,
					refreshToken: this.tokenState!.refreshToken,
					expiryTime: Date.now() + CursorTokenManager.TOKEN_VALIDITY,
				}

				await this.saveTokenState()
				console.log("Successfully refreshed Cursor token")
			})()

			await this.refreshPromise
		} catch (error) {
			const message = error instanceof Error ? error.message : "Failed to refresh token"
			throw new CursorTokenError(message, "network")
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
