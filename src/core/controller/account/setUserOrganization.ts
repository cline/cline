import type { Controller } from "../index"
import { Empty } from "@shared/proto/common"
import { UserOrganizationUpdateRequest } from "@shared/proto/account"
import { updateGlobalState } from "../../storage/state"

// Backend request deduplication tracking
const ongoingOrganizationSwitches = new Map<string, Promise<Empty>>()

/**
 * Handles setting the user's active organization
 * @param controller The controller instance
 * @param request UserOrganization to set as active
 * @returns Empty response
 */
export async function setUserOrganization(controller: Controller, request: UserOrganizationUpdateRequest): Promise<Empty> {
	// Create a unique key for this request (user + organization)
	const userId = controller.context.globalState.get("clineUserId") || "unknown"
	const requestKey = `${userId}:${request.organizationId || "personal"}`

	// Check if there's already an ongoing request for this user+organization combination
	const existingRequest = ongoingOrganizationSwitches.get(requestKey)
	if (existingRequest) {
		return existingRequest
	}

	// Create the promise for this request
	const requestPromise = (async (): Promise<Empty> => {
		try {
			if (!controller.accountService) {
				throw new Error("Account service not available")
			}

			await controller.accountService.switchAccount(request.organizationId)

			// Store the current active organization ID in global state
			await updateGlobalState(controller.context, "currentActiveOrganizationId", request.organizationId)

			return Empty.create({})
		} catch (error) {
			throw error
		} finally {
			// Clean up the ongoing request tracking
			ongoingOrganizationSwitches.delete(requestKey)
		}
	})()

	// Store the promise to prevent duplicate requests
	ongoingOrganizationSwitches.set(requestKey, requestPromise)

	return requestPromise
}
