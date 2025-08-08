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

export class ClineAccountService {
	private static instance: ClineAccountService
	private _authService: AuthService
	// TODO: replace this with a global API Host
	private readonly _baseUrl = "https://api.cline.bot"
	// private readonly _baseUrl = "https://core-api.staging.int.cline.bot"
	// private readonly _baseUrl = "http://localhost:7777"

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
	 * Validates if the user has sufficient credits to make API requests.
	 * This checks the user's balance and throws an error if the balance is insufficient or if the request fails.
	 * @throws Error if the user has insufficient credits or if the request fails
	 * @returns {Promise<void>} A promise that resolves if the user has sufficient credits.
	 */
	async validateRequest(): Promise<void> {
		try {
			const { organizations, id } = await this.authenticatedRequest<UserResponse>(`/api/v1/users/me`)
			const activeOrganization = organizations.find((org) => org.active)
			console.log("SwitchAuthToken: Active Organization", activeOrganization?.name || "No active organization")

			// Skip balance check for active organizations
			if (activeOrganization) {
				return
			}

			const balance = await this.authenticatedRequest<BalanceResponse>(`/api/v1/users/${id}/balance`)
			const currentBalance = Number(balance?.balance) || 0

			// Throw error if insufficient credits (balance <= 0)
			if (currentBalance <= 0) {
				throw new Error(
					JSON.stringify({
						code: "insufficient_credits",
						current_balance: currentBalance,
						message: "Not enough credits available",
					}),
				)
			}
		} catch (error) {
			console.error("Invalid Cline API request:", error)
			throw error instanceof Error ? error : new Error(`Invalid Request: ${error}`)
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
		// Call API to switch account
		try {
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
		} catch (error) {
			console.error("Error switching account:", error)
			throw error
		} finally {
			// After user switches account, we will force a refresh of the id token by calling this function that restores the refresh token and retrieves new auth info
			await this._authService.restoreRefreshTokenAndRetrieveAuthInfo()
		}
	}
}
