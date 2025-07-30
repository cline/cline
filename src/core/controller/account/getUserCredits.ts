import type { Controller } from "../index"
import type { EmptyRequest } from "@shared/proto/cline/common"
import { UserCreditsData } from "@shared/proto/cline/account"

/**
 * Handles fetching all user credits data (balance, usage, payments)
 * @param controller The controller instance
 * @param request Empty request
 * @returns User credits data response
 */
export async function getUserCredits(controller: Controller, request: EmptyRequest): Promise<UserCreditsData> {
	try {
		if (!controller.accountService) {
			throw new Error("Account service not available")
		}

		// Call the individual RPC variants in parallel
		const [balance, usageTransactions, paymentTransactions] = await Promise.all([
			controller.accountService.fetchBalanceRPC(),
			controller.accountService.fetchUsageTransactionsRPC(),
			controller.accountService.fetchPaymentTransactionsRPC(),
		])

		// If either call fails (returns undefined), throw an error
		if (balance === undefined) {
			throw new Error("Failed to fetch user credits data")
		}

		const packedPaymentTransactions = (paymentTransactions || []).map((tx) => {
			return {
				paidAt: JSON.stringify(tx),
				creatorId: tx.id,
				amountCents: tx.amountCents,
				credits: tx.credits,
			}
		})

		return UserCreditsData.create({
			balance: balance ? { currentBalance: balance.balance / 100 } : { currentBalance: 0 },
			usageTransactions: usageTransactions,
			paymentTransactions: packedPaymentTransactions,
		})
	} catch (error) {
		console.error(`Failed to fetch user credits data: ${error}`)
		throw error
	}
}
