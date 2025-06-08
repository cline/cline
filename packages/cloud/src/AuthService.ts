import crypto from "crypto"
import EventEmitter from "events"

import axios from "axios"
import * as vscode from "vscode"
import { z } from "zod"

import type { CloudUserInfo } from "@roo-code/types"

import { getClerkBaseUrl, getRooCodeApiUrl } from "./Config"
import { RefreshTimer } from "./RefreshTimer"
import { getUserAgent } from "./utils"

export interface AuthServiceEvents {
	"inactive-session": [data: { previousState: AuthState }]
	"active-session": [data: { previousState: AuthState }]
	"logged-out": [data: { previousState: AuthState }]
	"user-info": [data: { userInfo: CloudUserInfo }]
}

const authCredentialsSchema = z.object({
	clientToken: z.string().min(1, "Client token cannot be empty"),
	sessionId: z.string().min(1, "Session ID cannot be empty"),
})

type AuthCredentials = z.infer<typeof authCredentialsSchema>

const AUTH_CREDENTIALS_KEY = "clerk-auth-credentials"
const AUTH_STATE_KEY = "clerk-auth-state"

type AuthState = "initializing" | "logged-out" | "active-session" | "inactive-session"

export class AuthService extends EventEmitter<AuthServiceEvents> {
	private context: vscode.ExtensionContext
	private timer: RefreshTimer
	private state: AuthState = "initializing"
	private log: (...args: unknown[]) => void

	private credentials: AuthCredentials | null = null
	private sessionToken: string | null = null
	private userInfo: CloudUserInfo | null = null

	constructor(context: vscode.ExtensionContext, log?: (...args: unknown[]) => void) {
		super()

		this.context = context
		this.log = log || console.log

		this.timer = new RefreshTimer({
			callback: async () => {
				await this.refreshSession()
				return true
			},
			successInterval: 50_000,
			initialBackoffMs: 1_000,
			maxBackoffMs: 300_000,
		})
	}

	private async handleCredentialsChange(): Promise<void> {
		try {
			const credentials = await this.loadCredentials()

			if (credentials) {
				if (
					this.credentials === null ||
					this.credentials.clientToken !== credentials.clientToken ||
					this.credentials.sessionId !== credentials.sessionId
				) {
					this.transitionToInactiveSession(credentials)
				}
			} else {
				if (this.state !== "logged-out") {
					this.transitionToLoggedOut()
				}
			}
		} catch (error) {
			this.log("[auth] Error handling credentials change:", error)
		}
	}

	private transitionToLoggedOut(): void {
		this.timer.stop()

		const previousState = this.state

		this.credentials = null
		this.sessionToken = null
		this.userInfo = null
		this.state = "logged-out"

		this.emit("logged-out", { previousState })

		this.log("[auth] Transitioned to logged-out state")
	}

	private transitionToInactiveSession(credentials: AuthCredentials): void {
		this.credentials = credentials

		const previousState = this.state
		this.state = "inactive-session"

		this.sessionToken = null
		this.userInfo = null

		this.emit("inactive-session", { previousState })

		this.timer.start()

		this.log("[auth] Transitioned to inactive-session state")
	}

	/**
	 * Initialize the auth state
	 *
	 * This method loads tokens from storage and determines the current auth state.
	 * It also starts the refresh timer if we have an active session.
	 */
	public async initialize(): Promise<void> {
		if (this.state !== "initializing") {
			this.log("[auth] initialize() called after already initialized")
			return
		}

		await this.handleCredentialsChange()

		this.context.subscriptions.push(
			this.context.secrets.onDidChange((e) => {
				if (e.key === AUTH_CREDENTIALS_KEY) {
					this.handleCredentialsChange()
				}
			}),
		)
	}

	private async storeCredentials(credentials: AuthCredentials): Promise<void> {
		await this.context.secrets.store(AUTH_CREDENTIALS_KEY, JSON.stringify(credentials))
	}

	private async loadCredentials(): Promise<AuthCredentials | null> {
		const credentialsJson = await this.context.secrets.get(AUTH_CREDENTIALS_KEY)
		if (!credentialsJson) return null

		try {
			const parsedJson = JSON.parse(credentialsJson)
			return authCredentialsSchema.parse(parsedJson)
		} catch (error) {
			if (error instanceof z.ZodError) {
				this.log("[auth] Invalid credentials format:", error.errors)
			} else {
				this.log("[auth] Failed to parse stored credentials:", error)
			}
			return null
		}
	}

	private async clearCredentials(): Promise<void> {
		await this.context.secrets.delete(AUTH_CREDENTIALS_KEY)
	}

	/**
	 * Start the login process
	 *
	 * This method initiates the authentication flow by generating a state parameter
	 * and opening the browser to the authorization URL.
	 */
	public async login(): Promise<void> {
		try {
			// Generate a cryptographically random state parameter.
			const state = crypto.randomBytes(16).toString("hex")
			await this.context.globalState.update(AUTH_STATE_KEY, state)
			const packageJSON = this.context.extension?.packageJSON
			const publisher = packageJSON?.publisher ?? "RooVeterinaryInc"
			const name = packageJSON?.name ?? "roo-cline"
			const params = new URLSearchParams({
				state,
				auth_redirect: `${vscode.env.uriScheme}://${publisher}.${name}`,
			})
			const url = `${getRooCodeApiUrl()}/extension/sign-in?${params.toString()}`
			await vscode.env.openExternal(vscode.Uri.parse(url))
		} catch (error) {
			this.log(`[auth] Error initiating Roo Code Cloud auth: ${error}`)
			throw new Error(`Failed to initiate Roo Code Cloud authentication: ${error}`)
		}
	}

	/**
	 * Handle the callback from Roo Code Cloud
	 *
	 * This method is called when the user is redirected back to the extension
	 * after authenticating with Roo Code Cloud.
	 *
	 * @param code The authorization code from the callback
	 * @param state The state parameter from the callback
	 */
	public async handleCallback(code: string | null, state: string | null): Promise<void> {
		if (!code || !state) {
			vscode.window.showInformationMessage("Invalid Roo Code Cloud sign in url")
			return
		}

		try {
			// Validate state parameter to prevent CSRF attacks.
			const storedState = this.context.globalState.get(AUTH_STATE_KEY)

			if (state !== storedState) {
				this.log("[auth] State mismatch in callback")
				throw new Error("Invalid state parameter. Authentication request may have been tampered with.")
			}

			const { credentials } = await this.clerkSignIn(code)

			await this.storeCredentials(credentials)

			vscode.window.showInformationMessage("Successfully authenticated with Roo Code Cloud")
			this.log("[auth] Successfully authenticated with Roo Code Cloud")
		} catch (error) {
			this.log(`[auth] Error handling Roo Code Cloud callback: ${error}`)
			const previousState = this.state
			this.state = "logged-out"
			this.emit("logged-out", { previousState })
			throw new Error(`Failed to handle Roo Code Cloud callback: ${error}`)
		}
	}

	/**
	 * Log out
	 *
	 * This method removes all stored tokens and stops the refresh timer.
	 */
	public async logout(): Promise<void> {
		const oldCredentials = this.credentials

		try {
			// Clear credentials from storage - onDidChange will handle state transitions
			await this.clearCredentials()
			await this.context.globalState.update(AUTH_STATE_KEY, undefined)

			if (oldCredentials) {
				try {
					await this.clerkLogout(oldCredentials)
				} catch (error) {
					this.log("[auth] Error calling clerkLogout:", error)
				}
			}

			vscode.window.showInformationMessage("Logged out from Roo Code Cloud")
			this.log("[auth] Logged out from Roo Code Cloud")
		} catch (error) {
			this.log(`[auth] Error logging out from Roo Code Cloud: ${error}`)
			throw new Error(`Failed to log out from Roo Code Cloud: ${error}`)
		}
	}

	public getState(): AuthState {
		return this.state
	}

	public getSessionToken(): string | undefined {
		if (this.state === "active-session" && this.sessionToken) {
			return this.sessionToken
		}

		return
	}

	/**
	 * Check if the user is authenticated
	 *
	 * @returns True if the user is authenticated (has an active or inactive session)
	 */
	public isAuthenticated(): boolean {
		return this.state === "active-session" || this.state === "inactive-session"
	}

	public hasActiveSession(): boolean {
		return this.state === "active-session"
	}

	/**
	 * Refresh the session
	 *
	 * This method refreshes the session token using the client token.
	 */
	private async refreshSession(): Promise<void> {
		if (!this.credentials) {
			this.log("[auth] Cannot refresh session: missing credentials")
			this.state = "inactive-session"
			return
		}

		try {
			const previousState = this.state
			this.sessionToken = await this.clerkCreateSessionToken()
			this.state = "active-session"

			if (previousState !== "active-session") {
				this.log("[auth] Transitioned to active-session state")
				this.emit("active-session", { previousState })
				this.fetchUserInfo()
			}
		} catch (error) {
			this.log("[auth] Failed to refresh session", error)
			throw error
		}
	}

	private async fetchUserInfo(): Promise<void> {
		if (!this.credentials) {
			return
		}

		this.userInfo = await this.clerkMe()
		this.emit("user-info", { userInfo: this.userInfo })
	}

	/**
	 * Extract user information from the ID token
	 *
	 * @returns User information from ID token claims or null if no ID token available
	 */
	public getUserInfo(): CloudUserInfo | null {
		return this.userInfo
	}

	private async clerkSignIn(ticket: string): Promise<{ credentials: AuthCredentials; sessionToken: string }> {
		const formData = new URLSearchParams()
		formData.append("strategy", "ticket")
		formData.append("ticket", ticket)

		const response = await axios.post(`${getClerkBaseUrl()}/v1/client/sign_ins`, formData, {
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
				"User-Agent": this.userAgent(),
			},
		})

		// 3. Extract the client token from the Authorization header.
		const clientToken = response.headers.authorization

		if (!clientToken) {
			throw new Error("No authorization header found in the response")
		}

		// 4. Find the session using created_session_id and extract the JWT.
		const sessionId = response.data?.response?.created_session_id

		if (!sessionId) {
			throw new Error("No session ID found in the response")
		}

		// Find the session in the client sessions array.
		const session = response.data?.client?.sessions?.find((s: { id: string }) => s.id === sessionId)

		if (!session) {
			throw new Error("Session not found in the response")
		}

		// Extract the session token (JWT) and store it.
		const sessionToken = session.last_active_token?.jwt

		if (!sessionToken) {
			throw new Error("Session does not have a token")
		}

		const credentials = authCredentialsSchema.parse({ clientToken, sessionId })

		return { credentials, sessionToken }
	}

	private async clerkCreateSessionToken(): Promise<string> {
		const formData = new URLSearchParams()
		formData.append("_is_native", "1")

		const response = await axios.post(
			`${getClerkBaseUrl()}/v1/client/sessions/${this.credentials!.sessionId}/tokens`,
			formData,
			{
				headers: {
					"Content-Type": "application/x-www-form-urlencoded",
					Authorization: `Bearer ${this.credentials!.clientToken}`,
					"User-Agent": this.userAgent(),
				},
			},
		)

		const sessionToken = response.data?.jwt

		if (!sessionToken) {
			throw new Error("No JWT found in refresh response")
		}

		return sessionToken
	}

	private async clerkMe(): Promise<CloudUserInfo> {
		const response = await axios.get(`${getClerkBaseUrl()}/v1/me`, {
			headers: {
				Authorization: `Bearer ${this.credentials!.clientToken}`,
				"User-Agent": this.userAgent(),
			},
		})

		const userData = response.data?.response

		if (!userData) {
			throw new Error("No response user data")
		}

		const userInfo: CloudUserInfo = {}

		userInfo.name = `${userData?.first_name} ${userData?.last_name}`
		const primaryEmailAddressId = userData?.primary_email_address_id
		const emailAddresses = userData?.email_addresses

		if (primaryEmailAddressId && emailAddresses) {
			userInfo.email = emailAddresses.find(
				(email: { id: string }) => primaryEmailAddressId === email?.id,
			)?.email_address
		}

		userInfo.picture = userData?.image_url
		return userInfo
	}

	private async clerkLogout(credentials: AuthCredentials): Promise<void> {
		const formData = new URLSearchParams()
		formData.append("_is_native", "1")

		await axios.post(`${getClerkBaseUrl()}/v1/client/sessions/${credentials.sessionId}/remove`, formData, {
			headers: {
				Authorization: `Bearer ${credentials.clientToken}`,
				"User-Agent": this.userAgent(),
			},
		})
	}

	private userAgent(): string {
		return getUserAgent(this.context)
	}

	private static _instance: AuthService | null = null

	static get instance() {
		if (!this._instance) {
			throw new Error("AuthService not initialized")
		}

		return this._instance
	}

	static async createInstance(context: vscode.ExtensionContext, log?: (...args: unknown[]) => void) {
		if (this._instance) {
			throw new Error("AuthService instance already created")
		}

		this._instance = new AuthService(context, log)
		await this._instance.initialize()
		return this._instance
	}
}
