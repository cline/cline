import axios, { AxiosRequestConfig, AxiosResponse } from "axios"
import type { BalanceResponse, PaymentTransaction, UsageTransaction } from "@shared/ClineAccount"
import { ExtensionMessage } from "@shared/ExtensionMessage"

export class ClineAccountService {
	private readonly baseUrl = "https://api.cline.bot/v1"
	private postMessageToWebview: (message: ExtensionMessage) => Promise<void>
	private getClineApiKey: () => Promise<string | undefined>

	constructor(
		postMessageToWebview: (message: ExtensionMessage) => Promise<void>,
		getClineApiKey: () => Promise<string | undefined>,
	) {
		this.postMessageToWebview = postMessageToWebview
		this.getClineApiKey = getClineApiKey
	}

	/**
	 * Helper function to make authenticated requests to the Cline API
	 * @param endpoint The API endpoint to call (without the base URL)
	 * @param config Additional axios request configuration
	 * @returns The API response data
	 * @throws Error if the API key is not found or the request fails
	 */
	private async authenticatedRequest<T>(endpoint: string, config: AxiosRequestConfig = {}): Promise<T> {
		const clineApiKey = await this.getClineApiKey()

		if (!clineApiKey) {
			throw new Error("Cline API key not found")
		}

		const url = `${this.baseUrl}${endpoint}`
		const requestConfig: AxiosRequestConfig = {
			...config,
			headers: {
				Authorization: `Bearer ${clineApiKey}`,
				"Content-Type": "application/json",
				...config.headers,
			},
		}

		const response: AxiosResponse<T> = await axios.get(url, requestConfig)

		if (!response.data) {
			throw new Error(`Invalid response from ${endpoint} API`)
		}

		return response.data
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
