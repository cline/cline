import crypto from "crypto"
import EventEmitter from "events"

import * as vscode from "vscode"
import { z } from "zod"

import type { CloudUserInfo, CloudOrganizationMembership } from "@roo-code/types"

import { getClerkBaseUrl, getRooCodeApiUrl, PRODUCTION_CLERK_BASE_URL } from "./Config"
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

const AUTH_STATE_KEY = "clerk-auth-state"

type AuthState = "initializing" | "logged-out" | "active-session" | "inactive-session"

const clerkSignInResponseSchema = z.object({
	response: z.object({
		created_session_id: z.string(),
	}),
})

const clerkCreateSessionTokenResponseSchema = z.object({
	jwt: z.string(),
})

const clerkMeResponseSchema = z.object({
	response: z.object({
		first_name: z.string().optional(),
		last_name: z.string().optional(),
		image_url: z.string().optional(),
		primary_email_address_id: z.string().optional(),
		email_addresses: z
			.array(
				z.object({
					id: z.string(),
					email_address: z.string(),
				}),
			)
			.optional(),
	}),
})

const clerkOrganizationMembershipsSchema = z.object({
	response: z.array(
		z.object({
			id: z.string(),
			role: z.string(),
			permissions: z.array(z.string()).optional(),
			created_at: z.number().optional(),
			updated_at: z.number().optional(),
			organization: z.object({
				id: z.string(),
				name: z.string(),
				slug: z.string().optional(),
				image_url: z.string().optional(),
				has_image: z.boolean().optional(),
				created_at: z.number().optional(),
				updated_at: z.number().optional(),
			}),
		}),
	),
})

class InvalidClientTokenError extends Error {
	constructor() {
		super("Invalid/Expired client token")
		Object.setPrototypeOf(this, InvalidClientTokenError.prototype)
	}
}

export class AuthService extends EventEmitter<AuthServiceEvents> {
	private context: vscode.ExtensionContext
	private timer: RefreshTimer
	private state: AuthState = "initializing"
	private log: (...args: unknown[]) => void
	private readonly authCredentialsKey: string

	private credentials: AuthCredentials | null = null
	private sessionToken: string | null = null
	private userInfo: CloudUserInfo | null = null

	constructor(context: vscode.ExtensionContext, log?: (...args: unknown[]) => void) {
		super()

		this.context = context
		this.log = log || console.log

		// Calculate auth credentials key based on Clerk base URL
		const clerkBaseUrl = getClerkBaseUrl()
		if (clerkBaseUrl !== PRODUCTION_CLERK_BASE_URL) {
			this.authCredentialsKey = `clerk-auth-credentials-${clerkBaseUrl}`
		} else {
			this.authCredentialsKey = "clerk-auth-credentials"
		}

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
				if (e.key === this.authCredentialsKey) {
					this.handleCredentialsChange()
				}
			}),
		)
	}

	private async storeCredentials(credentials: AuthCredentials): Promise<void> {
		await this.context.secrets.store(this.authCredentialsKey, JSON.stringify(credentials))
	}

	private async loadCredentials(): Promise<AuthCredentials | null> {
		const credentialsJson = await this.context.secrets.get(this.authCredentialsKey)
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
		await this.context.secrets.delete(this.authCredentialsKey)
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

			const credentials = await this.clerkSignIn(code)

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
			if (error instanceof InvalidClientTokenError) {
				this.log("[auth] Invalid/Expired client token: clearing credentials")
				this.clearCredentials()
			}
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

	private async clerkSignIn(ticket: string): Promise<AuthCredentials> {
		const formData = new URLSearchParams()
		formData.append("strategy", "ticket")
		formData.append("ticket", ticket)

		const response = await fetch(`${getClerkBaseUrl()}/v1/client/sign_ins`, {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
				"User-Agent": this.userAgent(),
			},
			body: formData.toString(),
			signal: AbortSignal.timeout(10000),
		})

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`)
		}

		const {
			response: { created_session_id: sessionId },
		} = clerkSignInResponseSchema.parse(await response.json())

		// 3. Extract the client token from the Authorization header.
		const clientToken = response.headers.get("authorization")

		if (!clientToken) {
			throw new Error("No authorization header found in the response")
		}

		return authCredentialsSchema.parse({ clientToken, sessionId })
	}

	private async clerkCreateSessionToken(): Promise<string> {
		const formData = new URLSearchParams()
		formData.append("_is_native", "1")

		const response = await fetch(`${getClerkBaseUrl()}/v1/client/sessions/${this.credentials!.sessionId}/tokens`, {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
				Authorization: `Bearer ${this.credentials!.clientToken}`,
				"User-Agent": this.userAgent(),
			},
			body: formData.toString(),
			signal: AbortSignal.timeout(10000),
		})

		if (response.status >= 400 && response.status < 500) {
			throw new InvalidClientTokenError()
		} else if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`)
		}

		const data = clerkCreateSessionTokenResponseSchema.parse(await response.json())

		return data.jwt
	}

	private async clerkMe(): Promise<CloudUserInfo> {
		const response = await fetch(`${getClerkBaseUrl()}/v1/me`, {
			headers: {
				Authorization: `Bearer ${this.credentials!.clientToken}`,
				"User-Agent": this.userAgent(),
			},
			signal: AbortSignal.timeout(10000),
		})

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`)
		}

		const { response: userData } = clerkMeResponseSchema.parse(await response.json())

		const userInfo: CloudUserInfo = {}

		userInfo.name = `${userData.first_name} ${userData.last_name}`
		const primaryEmailAddressId = userData.primary_email_address_id
		const emailAddresses = userData.email_addresses

		if (primaryEmailAddressId && emailAddresses) {
			userInfo.email = emailAddresses.find(
				(email: { id: string }) => primaryEmailAddressId === email.id,
			)?.email_address
		}

		userInfo.picture = userData.image_url

		// Fetch organization memberships separately
		try {
			const orgMemberships = await this.clerkGetOrganizationMemberships()
			if (orgMemberships && orgMemberships.length > 0) {
				// Get the first (or active) organization membership
				const primaryOrgMembership = orgMemberships[0]
				const organization = primaryOrgMembership?.organization

				if (organization) {
					userInfo.organizationId = organization.id
					userInfo.organizationName = organization.name
					userInfo.organizationRole = primaryOrgMembership.role
				}
			}
		} catch (error) {
			this.log("[auth] Failed to fetch organization memberships:", error)
			// Don't throw - organization info is optional
		}

		return userInfo
	}

	private async clerkGetOrganizationMemberships(): Promise<CloudOrganizationMembership[]> {
		const response = await fetch(`${getClerkBaseUrl()}/v1/me/organization_memberships`, {
			headers: {
				Authorization: `Bearer ${this.credentials!.clientToken}`,
				"User-Agent": this.userAgent(),
			},
			signal: AbortSignal.timeout(10000),
		})

		return clerkOrganizationMembershipsSchema.parse(await response.json()).response
	}

	private async clerkLogout(credentials: AuthCredentials): Promise<void> {
		const formData = new URLSearchParams()
		formData.append("_is_native", "1")

		const response = await fetch(`${getClerkBaseUrl()}/v1/client/sessions/${credentials.sessionId}/remove`, {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
				Authorization: `Bearer ${credentials.clientToken}`,
				"User-Agent": this.userAgent(),
			},
			body: formData.toString(),
			signal: AbortSignal.timeout(10000),
		})

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`)
		}
	}

	private userAgent(): string {
		return getUserAgent(this.context)
	}
}
