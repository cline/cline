import crypto from "crypto"
import EventEmitter from "events"

import type { ExtensionContext } from "vscode"
import { z } from "zod"

import type {
	CloudUserInfo,
	CloudOrganizationMembership,
	AuthService,
	AuthServiceEvents,
	AuthState,
} from "@roo-code/types"

import { getClerkBaseUrl, getRooCodeApiUrl, PRODUCTION_CLERK_BASE_URL } from "./config.js"
import { getUserAgent } from "./utils.js"
import { importVscode } from "./importVscode.js"
import { InvalidClientTokenError } from "./errors.js"
import { RefreshTimer } from "./RefreshTimer.js"

const AUTH_STATE_KEY = "clerk-auth-state"

/**
 * AuthCredentials
 */

const authCredentialsSchema = z.object({
	clientToken: z.string().min(1, "Client token cannot be empty"),
	sessionId: z.string().min(1, "Session ID cannot be empty"),
	organizationId: z.string().nullable().optional(),
})

type AuthCredentials = z.infer<typeof authCredentialsSchema>

/**
 * Clerk Schemas
 */

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
		id: z.string().optional(),
		first_name: z.string().nullish(),
		last_name: z.string().nullish(),
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
		public_metadata: z.record(z.any()).optional(),
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

export class WebAuthService extends EventEmitter<AuthServiceEvents> implements AuthService {
	private context: ExtensionContext
	private timer: RefreshTimer
	private state: AuthState = "initializing"
	private log: (...args: unknown[]) => void
	private readonly authCredentialsKey: string

	private credentials: AuthCredentials | null = null
	private sessionToken: string | null = null
	private userInfo: CloudUserInfo | null = null
	private isFirstRefreshAttempt: boolean = false

	constructor(context: ExtensionContext, log?: (...args: unknown[]) => void) {
		super()

		this.context = context
		this.log = log || console.log

		this.log("[auth] Using WebAuthService")

		// Calculate auth credentials key based on Clerk base URL.
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

	private changeState(newState: AuthState): void {
		const previousState = this.state
		this.state = newState
		this.log(`[auth] changeState: ${previousState} -> ${newState}`)
		this.emit("auth-state-changed", { state: newState, previousState })
	}

	private async handleCredentialsChange(): Promise<void> {
		try {
			const credentials = await this.loadCredentials()

			if (credentials) {
				if (
					this.credentials === null ||
					this.credentials.clientToken !== credentials.clientToken ||
					this.credentials.sessionId !== credentials.sessionId ||
					this.credentials.organizationId !== credentials.organizationId
				) {
					this.transitionToAttemptingSession(credentials)
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

		this.credentials = null
		this.sessionToken = null
		this.userInfo = null

		this.changeState("logged-out")
	}

	private transitionToAttemptingSession(credentials: AuthCredentials): void {
		this.credentials = credentials

		this.sessionToken = null
		this.userInfo = null
		this.isFirstRefreshAttempt = true

		this.changeState("attempting-session")

		this.timer.stop()
		this.timer.start()
	}

	private transitionToInactiveSession(): void {
		this.sessionToken = null
		this.userInfo = null

		this.changeState("inactive-session")
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

	public broadcast(): void {}

	private async storeCredentials(credentials: AuthCredentials): Promise<void> {
		await this.context.secrets.store(this.authCredentialsKey, JSON.stringify(credentials))
	}

	private async loadCredentials(): Promise<AuthCredentials | null> {
		const credentialsJson = await this.context.secrets.get(this.authCredentialsKey)
		if (!credentialsJson) return null

		try {
			const parsedJson = JSON.parse(credentialsJson)
			const credentials = authCredentialsSchema.parse(parsedJson)

			// Migration: If no organizationId but we have userInfo, add it
			if (credentials.organizationId === undefined && this.userInfo?.organizationId) {
				credentials.organizationId = this.userInfo.organizationId
				await this.storeCredentials(credentials)
				this.log("[auth] Migrated credentials with organizationId")
			}

			return credentials
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
	 *
	 * @param landingPageSlug Optional slug of a specific landing page (e.g., "supernova", "special-offer", etc.)
	 */
	public async login(landingPageSlug?: string): Promise<void> {
		try {
			const vscode = await importVscode()

			if (!vscode) {
				throw new Error("VS Code API not available")
			}

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

			// Use landing page URL if slug is provided, otherwise use default sign-in URL
			const url = landingPageSlug
				? `${getRooCodeApiUrl()}/l/${landingPageSlug}?${params.toString()}`
				: `${getRooCodeApiUrl()}/extension/sign-in?${params.toString()}`

			await vscode.env.openExternal(vscode.Uri.parse(url))
		} catch (error) {
			const context = landingPageSlug ? ` (landing page: ${landingPageSlug})` : ""
			this.log(`[auth] Error initiating Roo Code Cloud auth${context}: ${error}`)
			throw new Error(`Failed to initiate Roo Code Cloud authentication${context}: ${error}`)
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
	 * @param organizationId The organization ID from the callback (null for personal accounts)
	 */
	public async handleCallback(
		code: string | null,
		state: string | null,
		organizationId?: string | null,
	): Promise<void> {
		if (!code || !state) {
			const vscode = await importVscode()

			if (vscode) {
				vscode.window.showInformationMessage("Invalid Roo Code Cloud sign in url")
			}

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

			// Set organizationId (null for personal accounts)
			credentials.organizationId = organizationId || null

			await this.storeCredentials(credentials)

			const vscode = await importVscode()

			if (vscode) {
				vscode.window.showInformationMessage("Successfully authenticated with Roo Code Cloud")
			}

			this.log("[auth] Successfully authenticated with Roo Code Cloud")
		} catch (error) {
			this.log(`[auth] Error handling Roo Code Cloud callback: ${error}`)
			this.changeState("logged-out")
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

			const vscode = await importVscode()

			if (vscode) {
				vscode.window.showInformationMessage("Logged out from Roo Code Cloud")
			}

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
	 * @returns True if the user is authenticated (has an active, attempting, or inactive session)
	 */
	public isAuthenticated(): boolean {
		return (
			this.state === "active-session" || this.state === "attempting-session" || this.state === "inactive-session"
		)
	}

	public hasActiveSession(): boolean {
		return this.state === "active-session"
	}

	/**
	 * Check if the user has an active session or is currently attempting to acquire one
	 *
	 * @returns True if the user has an active session or is attempting to get one
	 */
	public hasOrIsAcquiringActiveSession(): boolean {
		return this.state === "active-session" || this.state === "attempting-session"
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

			if (previousState !== "active-session") {
				this.changeState("active-session")
				this.fetchUserInfo()
			} else {
				this.state = "active-session"
			}
		} catch (error) {
			if (error instanceof InvalidClientTokenError) {
				this.log("[auth] Invalid/Expired client token: clearing credentials")
				this.clearCredentials()
			} else if (this.isFirstRefreshAttempt && this.state === "attempting-session") {
				this.isFirstRefreshAttempt = false
				this.transitionToInactiveSession()
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

	/**
	 * Get the stored organization ID from credentials
	 *
	 * @returns The stored organization ID, null for personal accounts or if no credentials exist
	 */
	public getStoredOrganizationId(): string | null {
		return this.credentials?.organizationId || null
	}

	/**
	 * Switch to a different organization context
	 * @param organizationId The organization ID to switch to, or null for personal account
	 */
	public async switchOrganization(organizationId: string | null): Promise<void> {
		if (!this.credentials) {
			throw new Error("Cannot switch organization: not authenticated")
		}

		// Update the stored credentials with the new organization ID
		const updatedCredentials: AuthCredentials = {
			...this.credentials,
			organizationId: organizationId,
		}

		// Store the updated credentials, handleCredentialsChange will handle the update
		await this.storeCredentials(updatedCredentials)
	}

	/**
	 * Get all organization memberships for the current user
	 * @returns Array of organization memberships
	 */
	public async getOrganizationMemberships(): Promise<CloudOrganizationMembership[]> {
		if (!this.credentials) {
			return []
		}

		try {
			return await this.clerkGetOrganizationMemberships()
		} catch (error) {
			this.log(`[auth] Failed to get organization memberships: ${error}`)
			return []
		}
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

		// Handle 3 cases for organization_id:
		// 1. Have an org id: organization_id=THE_ORG_ID
		// 2. Have a personal account: organization_id= (empty string)
		// 3. Don't know if you have an org id (old style credentials): don't send organization_id param at all
		const organizationId = this.getStoredOrganizationId()
		if (this.credentials?.organizationId !== undefined) {
			// We have organization context info (either org id or personal account)
			formData.append("organization_id", organizationId || "")
		}
		// If organizationId is undefined, don't send the param at all (old credentials)

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

		if (response.status === 401 || response.status === 404) {
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

		const payload = await response.json()
		const { response: userData } = clerkMeResponseSchema.parse(payload)

		const userInfo: CloudUserInfo = {
			id: userData.id,
			picture: userData.image_url,
		}

		const names = [userData.first_name, userData.last_name].filter((name) => !!name)
		userInfo.name = names.length > 0 ? names.join(" ") : undefined
		const primaryEmailAddressId = userData.primary_email_address_id
		const emailAddresses = userData.email_addresses

		if (primaryEmailAddressId && emailAddresses) {
			userInfo.email = emailAddresses.find(
				(email: { id: string }) => primaryEmailAddressId === email.id,
			)?.email_address
		}

		let extensionBridgeEnabled = true

		// Fetch organization info if user is in organization context
		try {
			const storedOrgId = this.getStoredOrganizationId()

			if (this.credentials?.organizationId !== undefined) {
				// We have organization context info
				if (storedOrgId !== null) {
					// User is in organization context - fetch user's memberships and filter
					const orgMemberships = await this.clerkGetOrganizationMemberships()
					const userMembership = this.findOrganizationMembership(orgMemberships, storedOrgId)

					if (userMembership) {
						this.setUserOrganizationInfo(userInfo, userMembership)

						extensionBridgeEnabled = await this.isExtensionBridgeEnabledForOrganization(storedOrgId)

						this.log("[auth] User in organization context:", {
							id: userMembership.organization.id,
							name: userMembership.organization.name,
							role: userMembership.role,
						})
					} else {
						this.log("[auth] Warning: User not found in stored organization:", storedOrgId)
					}
				} else {
					this.log("[auth] User in personal account context - not setting organization info")
				}
			} else {
				// Old credentials without organization context - fetch organization info to determine context
				const orgMemberships = await this.clerkGetOrganizationMemberships()
				const primaryOrgMembership = this.findPrimaryOrganizationMembership(orgMemberships)

				if (primaryOrgMembership) {
					this.setUserOrganizationInfo(userInfo, primaryOrgMembership)

					extensionBridgeEnabled = await this.isExtensionBridgeEnabledForOrganization(
						primaryOrgMembership.organization.id,
					)

					this.log("[auth] Legacy credentials: Found organization membership:", {
						id: primaryOrgMembership.organization.id,
						name: primaryOrgMembership.organization.name,
						role: primaryOrgMembership.role,
					})
				} else {
					this.log("[auth] Legacy credentials: No organization memberships found")
				}
			}
		} catch (error) {
			this.log("[auth] Failed to fetch organization info:", error)
			// Don't throw - organization info is optional
		}

		// Set the extension bridge enabled flag
		userInfo.extensionBridgeEnabled = extensionBridgeEnabled

		return userInfo
	}

	private findOrganizationMembership(
		memberships: CloudOrganizationMembership[],
		organizationId: string,
	): CloudOrganizationMembership | undefined {
		return memberships?.find((membership) => membership.organization.id === organizationId)
	}

	private findPrimaryOrganizationMembership(
		memberships: CloudOrganizationMembership[],
	): CloudOrganizationMembership | undefined {
		return memberships && memberships.length > 0 ? memberships[0] : undefined
	}

	private setUserOrganizationInfo(userInfo: CloudUserInfo, membership: CloudOrganizationMembership): void {
		userInfo.organizationId = membership.organization.id
		userInfo.organizationName = membership.organization.name
		userInfo.organizationRole = membership.role
		userInfo.organizationImageUrl = membership.organization.image_url
	}

	private async clerkGetOrganizationMemberships(): Promise<CloudOrganizationMembership[]> {
		if (!this.credentials) {
			this.log("[auth] Cannot get organization memberships: missing credentials")
			return []
		}

		const response = await fetch(`${getClerkBaseUrl()}/v1/me/organization_memberships`, {
			headers: {
				Authorization: `Bearer ${this.credentials.clientToken}`,
				"User-Agent": this.userAgent(),
			},
			signal: AbortSignal.timeout(10000),
		})

		return clerkOrganizationMembershipsSchema.parse(await response.json()).response
	}

	private async getOrganizationMetadata(
		organizationId: string,
	): Promise<{ public_metadata?: Record<string, unknown> } | null> {
		try {
			const response = await fetch(`${getClerkBaseUrl()}/v1/organizations/${organizationId}`, {
				headers: {
					Authorization: `Bearer ${this.credentials!.clientToken}`,
					"User-Agent": this.userAgent(),
				},
				signal: AbortSignal.timeout(10000),
			})

			if (!response.ok) {
				this.log(`[auth] Failed to fetch organization metadata: ${response.status} ${response.statusText}`)
				return null
			}

			const data = await response.json()
			return data.response || data
		} catch (error) {
			this.log("[auth] Error fetching organization metadata:", error)
			return null
		}
	}

	private async isExtensionBridgeEnabledForOrganization(organizationId: string): Promise<boolean> {
		const orgMetadata = await this.getOrganizationMetadata(organizationId)
		return orgMetadata?.public_metadata?.extension_bridge_enabled === true
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
