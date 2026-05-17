import { SubmitLimitIncreaseResponse } from "@shared/proto/cline/account"
import type { EmptyRequest } from "@shared/proto/cline/common"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from "../index"

/**
 * Submits a spend limit increase request to the user's org admin.
 * Called when the user clicks "Request Increase" on the SpendLimitError component.
 * @param controller The controller instance
 * @param _request Empty request
 * @returns SubmitLimitIncreaseResponse indicating success or failure
 */
export async function submitLimitIncreaseRequest(
	controller: Controller,
	_request: EmptyRequest,
): Promise<SubmitLimitIncreaseResponse> {
	try {
		if (!controller.accountService) {
			throw new Error("Account service not available")
		}

		await controller.accountService.submitLimitIncreaseRequestRPC()
		return SubmitLimitIncreaseResponse.create({ success: true })
	} catch (error) {
		Logger.error(`Failed to submit limit increase request: ${error}`)
		throw error
	}
}
