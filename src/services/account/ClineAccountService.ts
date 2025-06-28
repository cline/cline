import axios, { AxiosRequestConfig, AxiosResponse } from "axios"
import type { BalanceResponse, PaymentTransaction, UsageTransaction } from "@shared/ClineAccount"
import { AuthService } from "../auth/AuthService"

export class ClineAccountService {
	private static instance: ClineAccountService
	private _authService: AuthService
	// private readonly _authServiceUrl = "https://staging-app.cline.bot/auth"
	private readonly _baseUrl = "https://app.cline.bot/v1"
	// private readonly _baseUrl = "https://staging-app.cline.bot/v1"

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

		// TODO: replace this with firebase auth
		// TODO: use global API Host
		const requestConfig: AxiosRequestConfig = {
			...config,
			headers: {
				Authorization: `Bearer ${clineAccountAuthToken}`,
				"Content-Type": "application/json",
				...config.headers,
			},
		}

		try {
			const response: AxiosResponse<T> = await axios.get(url, requestConfig)
			console.log(`Extension: ClineAccountService: Fetched data from ${endpoint}`, response.data)

			if (!response.data) {
				throw new Error(`Invalid response from ${endpoint} API`)
			}

			return response.data
		} catch (error) {
			console.error(`Error fetching data from ${endpoint}:`, error)
			if (axios.isAxiosError(error)) {
				if (error.response) {
					console.error(`Response error from ${endpoint}:`, error.response.data)
				} else if (error.request) {
					console.error(`No response received from ${endpoint}:`, error.request)
				} else {
					console.error(`Error setting up request to ${endpoint}:`, error.message)
				}
			} else {
				console.error(`Unexpected error fetching from ${endpoint}:`, error)
			}
			throw new Error(`Failed to fetch data from ${endpoint}: ${error instanceof Error ? error.message : String(error)}`)
		}
	}

	/**
	 * RPC variant that fetches the user's current credit balance without posting to webview
	 * @returns Balance data or undefined if failed
	 */
	async fetchBalanceRPC(): Promise<BalanceResponse | undefined> {
		try {
			const data = await this.authenticatedRequest<BalanceResponse>("/user/credits/balance")
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
			const data = await this.authenticatedRequest<{ usageTransactions: UsageTransaction[] }>("/user/credits/usage")
			return data.usageTransactions
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
			const data = await this.authenticatedRequest<{ paymentTransactions: PaymentTransaction[] }>("/user/credits/payments")
			return data.paymentTransactions
		} catch (error) {
			console.error("Failed to fetch payment transactions (RPC):", error)
			return undefined
		}
	}
}
