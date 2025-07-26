import type { Controller } from "../index"
import { GetOrganizationCreditsRequest, OrganizationCreditsData, OrganizationUsageTransaction } from "@shared/proto/cline/account"

/**
 * Handles fetching all organization credits data (balance, usage, payments)
 * @param controller The controller instance
 * @param request Organization credits request
 * @returns Organization credits data response
 */
export async function getOrganizationCredits(
	controller: Controller,
	request: GetOrganizationCreditsRequest,
): Promise<OrganizationCreditsData> {
	try {
		if (!controller.accountService) {
			throw new Error("Account service not available")
		}

		// Call the individual RPC variants in parallel
		const [balanceData, usageTransactions] = await Promise.all([
			controller.accountService.fetchOrganizationCreditsRPC(request.organizationId),
			controller.accountService.fetchOrganizationUsageTransactionsRPC(request.organizationId),
		])

		// If balance call fails (returns undefined), throw an error
		if (!balanceData) {
			throw new Error("Failed to fetch organization credits data")
		}

		return OrganizationCreditsData.create({
			balance: balanceData ? { currentBalance: balanceData.balance / 100 } : { currentBalance: 0 },
			organizationId: balanceData?.organizationId || "",
			usageTransactions:
				usageTransactions?.map((tx) =>
					OrganizationUsageTransaction.create({
						aiInferenceProviderName: tx.aiInferenceProviderName,
						aiModelName: tx.aiModelName,
						aiModelTypeName: tx.aiModelTypeName,
						completionTokens: tx.completionTokens,
						costUsd: tx.costUsd,
						createdAt: tx.createdAt,
						creditsUsed: tx.creditsUsed,
						generationId: tx.generationId,
						organizationId: tx.organizationId,
						promptTokens: tx.promptTokens,
						totalTokens: tx.totalTokens,
						userId: tx.userId,
					}),
				) || [],
		})
	} catch (error) {
		console.error(`Failed to fetch organization credits data: ${error}`)
		throw error
	}
}
