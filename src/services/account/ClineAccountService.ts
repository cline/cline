import axios, { AxiosRequestConfig, AxiosResponse } from "axios"
import type {
	BalanceResponse,
	OrganizationBalanceResponse,
	OrganizationUsageTransaction,
	PaymentTransaction,
	UsageTransaction,
	UserResponse,
} from "@shared/ClineAccount"
import { AuthService } from "../auth/AuthService"
import { clineEnvConfig } from "@/config"

export class ClineAccountService {
	private static instance: ClineAccountService
	private _authService: AuthService
	private readonly _baseUrl = clineEnvConfig.apiBaseUrl

	// Service-level request deduplication tracking
	private ongoingSwitchRequests = new Map<string, Promise<void>>()

	constructor() {
		this._authService = AuthService.getInstance()
	}

	/**
	 * Returns the singleton instance of ClineAccountService
	 * @returns Singleton instance of ClineAccountService
	 */
	public static getInstance(): ClineAccountService {
		if (!ClineAccountService.instance) {
			ClineAccountService.instance = new ClineAccountService()
		}
		return ClineAccountService.instance
	}

	/**
	 * Returns the base URL for the Cline API
	 * @returns The base URL as a string
	 */
	get baseUrl(): string {
		return this._baseUrl
	}

	/**
	 * Helper function to make authenticated requests to the Cline API
	 * @param endpoint The API endpoint to call (without the base URL)
	 * @param config Additional axios request configuration
	 * @returns The API response data
	 * @throws Error if the API key is not found or the request fails
	 */
	private async authenticatedRequest<T>(endpoint: string, config: AxiosRequestConfig = {}): Promise<T> {
		const url = `${this._baseUrl}${endpoint}`

		const clineAccountAuthToken = await this._authService.getAuthToken()

		const requestConfig: AxiosRequestConfig = {
			...config,
			headers: {
				Authorization: `Bearer ${clineAccountAuthToken}`,
				"Content-Type": "application/json",
				...config.headers,
			},
		}
		const response: AxiosResponse<{ data?: T; error: string; success: boolean }> = await axios.request({
			url,
			method: "GET",
			...requestConfig,
		})
		const status = response.status
		if (status < 200 || status >= 300) {
			throw new Error(`Request to ${endpoint} failed with status ${status}`)
		}
		if (response.statusText !== "No Content" && (!response.data || !response.data.data)) {
			throw new Error(`Invalid response from ${endpoint} API`)
		}
		if (typeof response.data === "object" && !response.data.success) {
			throw new Error(`API error: ${response.data.error}`)
		}
		if (response.statusText === "No Content") {
			return {} as T // Return empty object if no content
		} else {
			return response.data.data as T
		}
	}

	/**
	 * RPC variant that fetches the user's current credit balance without posting to webview
	 * @returns Balance data or undefined if failed
	 */
	async fetchBalanceRPC(): Promise<BalanceResponse | undefined> {
		try {
			const me = await this.fetchMe()
			if (!me || !me.id) {
				console.error("Failed to fetch user ID for usage transactions")
				return undefined
			}
			const data = await this.authenticatedRequest<BalanceResponse>(`/api/v1/users/${me.id}/balance`)
			return data
		} catch (error) {
			console.error("Failed to fetch balance (RPC):", error)
			return undefined
		}
	}

	/**
	 * RPC variant that fetches the user's usage transactions without posting to webview
	 * @returns Usage transactions or undefined if failed
	 */
	async fetchUsageTransactionsRPC(): Promise<UsageTransaction[] | undefined> {
		try {
			const me = await this.fetchMe()
			if (!me || !me.id) {
				console.error("Failed to fetch user ID for usage transactions")
				return undefined
			}
			const data = await this.authenticatedRequest<{ items: UsageTransaction[] }>(`/api/v1/users/${me.id}/usages`)
			return data.items
		} catch (error) {
			console.error("Failed to fetch usage transactions (RPC):", error)
			return undefined
		}
	}

	/**
	 * RPC variant that fetches the user's payment transactions without posting to webview
	 * @returns Payment transactions or undefined if failed
	 */
	async fetchPaymentTransactionsRPC(): Promise<PaymentTransaction[] | undefined> {
		try {
			const me = await this.fetchMe()
			if (!me || !me.id) {
				console.error("Failed to fetch user ID for usage transactions")
				return undefined
			}
			const data = await this.authenticatedRequest<{ paymentTransactions: PaymentTransaction[] }>(
				`/api/v1/users/${me.id}/payments`,
			)
			return data.paymentTransactions
		} catch (error) {
			console.error("Failed to fetch payment transactions (RPC):", error)
			return undefined
		}
	}

	/**
	 * Fetches the current user data
	 * @returns UserResponse or undefined if failed
	 */
	async fetchMe(): Promise<UserResponse | undefined> {
		try {
			const data = await this.authenticatedRequest<UserResponse>(`/api/v1/users/me`)
			return data
		} catch (error) {
			console.error("Failed to fetch user data (RPC):", error)
			return undefined
		}
	}

	/**
	 * Fetches the current user's organizations
	 * @returns UserResponse["organizations"] or undefined if failed
	 */
	async fetchUserOrganizationsRPC(): Promise<UserResponse["organizations"] | undefined> {
		try {
			const me = await this.fetchMe()
			if (!me || !me.organizations) {
				console.error("Failed to fetch user organizations")
				return undefined
			}
			return me.organizations
		} catch (error) {
			console.error("Failed to fetch user organizations (RPC):", error)
			return undefined
		}
	}

	/**
	 * Fetches the current user's organization credits
	 * @returns {Promise<OrganizationBalanceResponse>} A promise that resolves to the active organization balance.
	 */
	async fetchOrganizationCreditsRPC(organizationId: string): Promise<OrganizationBalanceResponse | undefined> {
		try {
			const data = await this.authenticatedRequest<OrganizationBalanceResponse>(
				`/api/v1/organizations/${organizationId}/balance`,
			)
			return data
		} catch (error) {
			console.error("Failed to fetch active organization balance (RPC):", error)
			return undefined
		}
	}

	/**
	 * Fetches the current user's organization transactions
	 * @returns {Promise<OrganizationUsageTransaction[]>} A promise that resolves to the active organization transactions.
	 */
	async fetchOrganizationUsageTransactionsRPC(organizationId: string): Promise<OrganizationUsageTransaction[] | undefined> {
		try {
			const me = await this.fetchMe()
			if (!me || !me.id) {
				console.error("Failed to fetch user ID for active organization transactions")
				return undefined
			}
			const memberId = me.organizations.find((org) => org.organizationId === organizationId)?.memberId
			if (!memberId) {
				console.error("Failed to find member ID for active organization transactions")
				return undefined
			}
			const data = await this.authenticatedRequest<{ items: OrganizationUsageTransaction[] }>(
				`/api/v1/organizations/${organizationId}/members/${memberId}/usages`,
			)
			return data.items
		} catch (error) {
			console.error("Failed to fetch active organization transactions (RPC):", error)
			return undefined
		}
	}

	/**
	 * Switches the active account to the specified organization or personal account.
	 * @param organizationId - Optional organization ID to switch to. If not provided, it will switch to the personal account.
	 * @returns {Promise<void>} A promise that resolves when the account switch is complete.
	 * @throws {Error} If the account switch fails, an error will be thrown.
	 */
	async switchAccount(organizationId?: string): Promise<void> {
		const startTime = performance.now()
		console.log(`[ORG_SWITCH] switchAccount started at ${new Date().toISOString()}`)
		console.log(`[ORG_SWITCH] Target organizationId: ${organizationId || "null (personal account)"}`)

		const requestKey = organizationId || "personal"

		// Check if there's already an ongoing switch request for this organization
		const existingRequest = this.ongoingSwitchRequests.get(requestKey)
		if (existingRequest) {
			console.log(`[ORG_SWITCH_DEDUP] Service request blocked - already switching to "${requestKey}"`)
			console.log(`[ORG_SWITCH_DEDUP] Returning existing promise for duplicate service request`)
			return existingRequest
		}

		// Create the promise for this request
		const requestPromise = (async (): Promise<void> => {
			// Token validation before API call
			let tokenBeforeSwitch: string | null = null
			let tokenValidBeforeSwitch = false

			try {
				console.log(`[TOKEN_REFRESH] Checking token status before organization switch...`)
				const tokenCheckStartTime = performance.now()

				tokenBeforeSwitch = await this._authService.getAuthToken()
				tokenValidBeforeSwitch = tokenBeforeSwitch !== null

				const tokenCheckEndTime = performance.now()
				console.log(`[TOKEN_REFRESH] Token check completed in ${(tokenCheckEndTime - tokenCheckStartTime).toFixed(2)}ms`)
				console.log(`[TOKEN_REFRESH] Token valid before switch: ${tokenValidBeforeSwitch}`)
				console.log(`[TOKEN_REFRESH] Token length before switch: ${tokenBeforeSwitch?.length || 0} characters`)

				if (tokenBeforeSwitch) {
					// Try to decode token expiry if it's a JWT
					try {
						const tokenParts = tokenBeforeSwitch.split(".")
						if (tokenParts.length === 3) {
							const payload = JSON.parse(atob(tokenParts[1]))
							const expiry = payload.exp ? new Date(payload.exp * 1000) : null
							const now = new Date()
							console.log(`[TOKEN_REFRESH] Token expires at: ${expiry?.toISOString() || "unknown"}`)
							console.log(`[TOKEN_REFRESH] Current time: ${now.toISOString()}`)
							console.log(`[TOKEN_REFRESH] Token expired: ${expiry ? expiry < now : "unknown"}`)
						}
					} catch (e) {
						console.log(`[TOKEN_REFRESH] Could not decode token expiry (not a JWT or malformed)`)
					}
				}
			} catch (error) {
				console.log(`[TOKEN_REFRESH] Error checking token before switch:`, error)
			}

			// Call API to switch account
			try {
				console.log(`[ORG_SWITCH] Preparing API request to /api/v1/users/active-account`)
				const requestStartTime = performance.now()

				// make XHR request to switch account
				const response = await this.authenticatedRequest<string>(`/api/v1/users/active-account`, {
					method: "PUT",
					headers: {
						"Content-Type": "application/json",
					},
					data: {
						organizationId: organizationId || null, // Pass organization if provided
					},
				})

				const requestEndTime = performance.now()
				console.log(
					`[ORG_SWITCH] API request to /api/v1/users/active-account completed in ${(requestEndTime - requestStartTime).toFixed(2)}ms`,
				)
				console.log(`[ORG_SWITCH] API response received:`, response)
			} catch (error) {
				const errorTime = performance.now()
				console.error(`[ORG_SWITCH] Error switching account after ${(errorTime - startTime).toFixed(2)}ms:`, error)
				throw error
			} finally {
				// Token validation after API call but before refresh
				let tokenAfterSwitch: string | null = null
				let tokenValidAfterSwitch = false

				try {
					console.log(`[TOKEN_REFRESH] Checking token status after API call, before refresh...`)
					const tokenCheckStartTime = performance.now()

					// Get the current token without triggering a refresh
					const authInfo = (this._authService as any)._clineAuthInfo
					tokenAfterSwitch = authInfo?.idToken || null
					tokenValidAfterSwitch = tokenAfterSwitch !== null

					const tokenCheckEndTime = performance.now()
					console.log(
						`[TOKEN_REFRESH] Post-API token check completed in ${(tokenCheckEndTime - tokenCheckStartTime).toFixed(2)}ms`,
					)
					console.log(`[TOKEN_REFRESH] Token valid after API call: ${tokenValidAfterSwitch}`)
					console.log(`[TOKEN_REFRESH] Token length after API call: ${tokenAfterSwitch?.length || 0} characters`)
					console.log(`[TOKEN_REFRESH] Token changed during API call: ${tokenBeforeSwitch !== tokenAfterSwitch}`)

					if (tokenAfterSwitch) {
						// Try to decode token expiry if it's a JWT
						try {
							const tokenParts = tokenAfterSwitch.split(".")
							if (tokenParts.length === 3) {
								const payload = JSON.parse(atob(tokenParts[1]))
								const expiry = payload.exp ? new Date(payload.exp * 1000) : null
								const now = new Date()
								console.log(`[TOKEN_REFRESH] Token expires at (after API): ${expiry?.toISOString() || "unknown"}`)
								console.log(`[TOKEN_REFRESH] Token expired (after API): ${expiry ? expiry < now : "unknown"}`)

								// Check if token needs refresh based on expiry
								const needsRefreshByExpiry = expiry ? expiry < now : false
								console.log(`[TOKEN_REFRESH] Token needs refresh by expiry: ${needsRefreshByExpiry}`)
							}
						} catch (e) {
							console.log(`[TOKEN_REFRESH] Could not decode token expiry after API call`)
						}
					}
				} catch (error) {
					console.log(`[TOKEN_REFRESH] Error checking token after API call:`, error)
				}

				// Determine if refresh is actually needed
				let needsRefreshByExpiry = false
				if (tokenAfterSwitch) {
					try {
						const tokenParts = tokenAfterSwitch.split(".")
						if (tokenParts.length === 3) {
							const payload = JSON.parse(atob(tokenParts[1]))
							const expiry = payload.exp ? new Date(payload.exp * 1000) : null
							const now = new Date()
							const fiveMinutesInMs = 5 * 60 * 1000
							needsRefreshByExpiry = expiry ? expiry.getTime() < now.getTime() + fiveMinutesInMs : false
						}
					} catch (e) {
						needsRefreshByExpiry = true // If we can't decode, assume refresh needed
					}
				}

				const shouldRefresh = !tokenValidAfterSwitch || needsRefreshByExpiry
				console.log(`[TOKEN_REFRESH] Should refresh token: ${shouldRefresh}`)
				console.log(
					`[TOKEN_REFRESH] Refresh reason: ${!tokenValidAfterSwitch ? "token invalid" : needsRefreshByExpiry ? "token expires soon" : "not needed"}`,
				)

				if (shouldRefresh) {
					console.log(`[ORG_SWITCH] Starting token refresh process...`)
					const tokenRefreshStartTime = performance.now()

					// After user switches account, we will force a refresh of the id token by calling this function that restores the refresh token and retrieves new auth info
					await this._authService.restoreRefreshTokenAndRetrieveAuthInfo()

					const tokenRefreshEndTime = performance.now()
					console.log(
						`[ORG_SWITCH] Token refresh completed in ${(tokenRefreshEndTime - tokenRefreshStartTime).toFixed(2)}ms`,
					)

					// Check token after refresh
					try {
						const tokenAfterRefresh = await this._authService.getAuthToken()
						console.log(`[TOKEN_REFRESH] Token valid after refresh: ${tokenAfterRefresh !== null}`)
						console.log(`[TOKEN_REFRESH] Token length after refresh: ${tokenAfterRefresh?.length || 0} characters`)
						console.log(`[TOKEN_REFRESH] Token changed during refresh: ${tokenAfterSwitch !== tokenAfterRefresh}`)

						if (tokenAfterRefresh && tokenAfterSwitch) {
							console.log(
								`[TOKEN_REFRESH] Refresh was ${tokenAfterSwitch === tokenAfterRefresh ? "unnecessary" : "necessary"} - token ${tokenAfterSwitch === tokenAfterRefresh ? "unchanged" : "updated"}`,
							)
						}
					} catch (error) {
						console.log(`[TOKEN_REFRESH] Error checking token after refresh:`, error)
					}
				} else {
					console.log(`[TOKEN_REFRESH] Skipping token refresh - token is still valid`)
					const estimatedTimeSaved = 300 // Average refresh time
					console.log(`[TOKEN_REFRESH] Estimated time saved: ${estimatedTimeSaved}ms`)
				}

				const totalTime = performance.now()
				console.log(`[ORG_SWITCH] switchAccount completed in ${(totalTime - startTime).toFixed(2)}ms`)

				// Clean up the ongoing request tracking
				this.ongoingSwitchRequests.delete(requestKey)
				console.log(`[ORG_SWITCH_DEDUP] Service request lock cleared for "${requestKey}"`)
			}
		})()

		// Store the promise to prevent duplicate requests
		this.ongoingSwitchRequests.set(requestKey, requestPromise)
		console.log(`[ORG_SWITCH_DEDUP] Service request allowed - setting lock for "${requestKey}"`)

		return requestPromise
	}
}
