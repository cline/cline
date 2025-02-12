import { ExtensionContext } from "vscode"
import { refreshCursorToken } from "../../../../webview-ui/src/utils/cursor/auth"
import { CursorConfig } from "../../../shared/config/cursor"
import crypto from "crypto"

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
	private clientKey: string

	constructor(private readonly context: ExtensionContext) {
		this.clientKey = this.generateClientKey()
		this.initializeConfig()
		this.loadTokenState()
	}

	private generateClientKey(): string {
		// Generate a SHA-256 hash of a random UUID
		const uuid = crypto.randomUUID()
		return crypto.createHash("sha256").update(uuid).digest("hex")
	}

	private initializeConfig(): void {
		// Modify the CursorConfig to use our generated key
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
			}
		} catch {
			this.tokenState = null
		}
	}

	private async saveTokenState(): Promise<void> {
		try {
			if (this.tokenState) {
				await Promise.all([
					this.context.secrets.store(CursorConfig.STORAGE_KEYS.ACCESS_TOKEN, this.tokenState.accessToken),
					this.context.secrets.store(CursorConfig.STORAGE_KEYS.REFRESH_TOKEN, this.tokenState.refreshToken),
				])
			} else {
				await this.clearTokenState()
			}
		} catch {
			throw new CursorTokenError("Failed to save token state", "unknown")
		}
	}

	private async clearTokenState(): Promise<void> {
		try {
			await Promise.all([
				this.context.secrets.delete(CursorConfig.STORAGE_KEYS.ACCESS_TOKEN),
				this.context.secrets.delete(CursorConfig.STORAGE_KEYS.REFRESH_TOKEN),
			])
			this.tokenState = null
		} catch {
			// Ignore clear errors
		}
	}

	public async setTokens(accessToken: string, refreshToken: string): Promise<void> {
		this.tokenState = {
			accessToken,
			refreshToken,
			expiryTime: Date.now() + CursorConfig.TOKEN_VALIDITY,
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
		if (timeUntilExpiry <= CursorConfig.TOKEN_REFRESH_THRESHOLD) {
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
				const { access_token } = await refreshCursorToken(this.tokenState!.refreshToken)

				this.tokenState = {
					accessToken: access_token,
					refreshToken: this.tokenState!.refreshToken,
					expiryTime: Date.now() + CursorConfig.TOKEN_VALIDITY,
				}

				await this.saveTokenState()
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
