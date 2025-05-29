import crypto from "crypto"
import EventEmitter from "events"

import axios from "axios"
import * as vscode from "vscode"

import type { CloudUserInfo } from "@roo-code/types"

import { getClerkBaseUrl, getRooCodeApiUrl } from "./Config"
import { RefreshTimer } from "./RefreshTimer"

export interface AuthServiceEvents {
	"active-session": [data: { previousState: AuthState }]
	"logged-out": [data: { previousState: AuthState }]
	"user-info": [data: { userInfo: CloudUserInfo }]
}

const CLIENT_TOKEN_KEY = "clerk-client-token"
const SESSION_ID_KEY = "clerk-session-id"
const AUTH_STATE_KEY = "clerk-auth-state"

type AuthState = "initializing" | "logged-out" | "active-session" | "inactive-session"

export class AuthService extends EventEmitter<AuthServiceEvents> {
	private context: vscode.ExtensionContext
	private timer: RefreshTimer
	private state: AuthState = "initializing"

	private clientToken: string | null = null
	private sessionToken: string | null = null
	private sessionId: string | null = null
	private userInfo: CloudUserInfo | null = null

	constructor(context: vscode.ExtensionContext) {
		super()

		this.context = context

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

	/**
	 * Initialize the auth state
	 *
	 * This method loads tokens from storage and determines the current auth state.
	 * It also starts the refresh timer if we have an active session.
	 */
	public async initialize(): Promise<void> {
		if (this.state !== "initializing") {
			console.log("[auth] initialize() called after already initialized")
			return
		}

		try {
			this.clientToken = (await this.context.secrets.get(CLIENT_TOKEN_KEY)) || null
			this.sessionId = this.context.globalState.get<string>(SESSION_ID_KEY) || null

			// Determine initial state.
			if (!this.clientToken || !this.sessionId) {
				// TODO: it may be possible to get a new session with the client,
				// but the obvious Clerk endpoints don't support that.
				const previousState = this.state
				this.state = "logged-out"
				this.emit("logged-out", { previousState })
			} else {
				this.state = "inactive-session"
				this.timer.start()
			}

			console.log(`[auth] Initialized with state: ${this.state}`)
		} catch (error) {
			console.error(`[auth] Error initializing AuthService: ${error}`)
			this.state = "logged-out"
		}
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
			console.error(`[auth] Error initiating Roo Code Cloud auth: ${error}`)
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
				console.log("[auth] State mismatch in callback")
				throw new Error("Invalid state parameter. Authentication request may have been tampered with.")
			}

			const { clientToken, sessionToken, sessionId } = await this.clerkSignIn(code)

			await this.context.secrets.store(CLIENT_TOKEN_KEY, clientToken)
			await this.context.globalState.update(SESSION_ID_KEY, sessionId)

			this.clientToken = clientToken
			this.sessionId = sessionId
			this.sessionToken = sessionToken

			const previousState = this.state
			this.state = "active-session"
			this.emit("active-session", { previousState })
			this.timer.start()

			this.fetchUserInfo()

			vscode.window.showInformationMessage("Successfully authenticated with Roo Code Cloud")
			console.log("[auth] Successfully authenticated with Roo Code Cloud")
		} catch (error) {
			console.log(`[auth] Error handling Roo Code Cloud callback: ${error}`)
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
		try {
			this.timer.stop()

			await this.context.secrets.delete(CLIENT_TOKEN_KEY)
			await this.context.globalState.update(SESSION_ID_KEY, undefined)
			await this.context.globalState.update(AUTH_STATE_KEY, undefined)

			const oldClientToken = this.clientToken
			const oldSessionId = this.sessionId

			this.clientToken = null
			this.sessionToken = null
			this.sessionId = null
			this.userInfo = null
			const previousState = this.state
			this.state = "logged-out"
			this.emit("logged-out", { previousState })

			if (oldClientToken && oldSessionId) {
				await this.clerkLogout(oldClientToken, oldSessionId)
			}

			this.fetchUserInfo()

			vscode.window.showInformationMessage("Logged out from Roo Code Cloud")
			console.log("[auth] Logged out from Roo Code Cloud")
		} catch (error) {
			console.log(`[auth] Error logging out from Roo Code Cloud: ${error}`)
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
		if (!this.sessionId || !this.clientToken) {
			console.log("[auth] Cannot refresh session: missing session ID or token")
			this.state = "inactive-session"
			return
		}

		const previousState = this.state
		this.sessionToken = await this.clerkCreateSessionToken()
		this.state = "active-session"

		if (previousState !== "active-session") {
			this.emit("active-session", { previousState })
			this.fetchUserInfo()
		}
	}

	private async fetchUserInfo(): Promise<void> {
		if (!this.clientToken) {
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

	private async clerkSignIn(
		ticket: string,
	): Promise<{ clientToken: string; sessionToken: string; sessionId: string }> {
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
		const createdSessionId = response.data?.response?.created_session_id

		if (!createdSessionId) {
			throw new Error("No session ID found in the response")
		}

		// Find the session in the client sessions array.
		const session = response.data?.client?.sessions?.find((s: { id: string }) => s.id === createdSessionId)

		if (!session) {
			throw new Error("Session not found in the response")
		}

		// Extract the session token (JWT) and store it.
		const sessionToken = session.last_active_token?.jwt

		if (!sessionToken) {
			throw new Error("Session does not have a token")
		}

		return { clientToken, sessionToken, sessionId: session.id }
	}

	private async clerkCreateSessionToken(): Promise<string> {
		const formData = new URLSearchParams()
		formData.append("_is_native", "1")

		const response = await axios.post(
			`${getClerkBaseUrl()}/v1/client/sessions/${this.sessionId}/tokens`,
			formData,
			{
				headers: {
					"Content-Type": "application/x-www-form-urlencoded",
					Authorization: `Bearer ${this.clientToken}`,
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
				Authorization: `Bearer ${this.clientToken}`,
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

	private async clerkLogout(clientToken: string, sessionId: string): Promise<void> {
		const formData = new URLSearchParams()
		formData.append("_is_native", "1")

		await axios.post(`${getClerkBaseUrl()}/v1/client/sessions/${sessionId}/remove`, formData, {
			headers: {
				Authorization: `Bearer ${clientToken}`,
				"User-Agent": this.userAgent(),
			},
		})
	}

	private userAgent(): string {
		return `Roo-Code ${this.context.extension?.packageJSON?.version}`
	}

	private static _instance: AuthService | null = null

	static get instance() {
		if (!this._instance) {
			throw new Error("AuthService not initialized")
		}

		return this._instance
	}

	static async createInstance(context: vscode.ExtensionContext) {
		if (this._instance) {
			throw new Error("AuthService instance already created")
		}

		this._instance = new AuthService(context)
		await this._instance.initialize()
		return this._instance
	}
}
