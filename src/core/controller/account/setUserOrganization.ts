import type { Controller } from "../index"
import { Empty } from "@shared/proto/common"
import { UserOrganizationUpdateRequest } from "@shared/proto/account"

// Backend request deduplication tracking
const ongoingOrganizationSwitches = new Map<string, Promise<Empty>>()

/**
 * Handles setting the user's active organization
 * @param controller The controller instance
 * @param request UserOrganization to set as active
 * @returns Empty response
 */
export async function setUserOrganization(controller: Controller, request: UserOrganizationUpdateRequest): Promise<Empty> {
	const startTime = performance.now()
	console.log(`[ORG_SWITCH] setUserOrganization started at ${new Date().toISOString()}`)
	console.log(`[ORG_SWITCH] Request organizationId: ${request.organizationId || "undefined"}`)

	// Create a unique key for this request (user + organization)
	const userId = controller.context.globalState.get("clineUserId") || "unknown"
	const requestKey = `${userId}:${request.organizationId || "personal"}`

	// Check if there's already an ongoing request for this user+organization combination
	const existingRequest = ongoingOrganizationSwitches.get(requestKey)
	if (existingRequest) {
		console.log(`[ORG_SWITCH_DEDUP] Backend request blocked - already switching to "${requestKey}"`)
		console.log(`[ORG_SWITCH_DEDUP] Returning existing promise for duplicate request`)
		return existingRequest
	}

	// Create the promise for this request
	const requestPromise = (async (): Promise<Empty> => {
		try {
			const validationTime = performance.now()
			if (!controller.accountService) {
				console.error(`[ORG_SWITCH] Account service not available after ${(validationTime - startTime).toFixed(2)}ms`)
				throw new Error("Account service not available")
			}
			console.log(`[ORG_SWITCH] Account service validation passed in ${(validationTime - startTime).toFixed(2)}ms`)

			// Switch to the specified organization using the account service
			console.log(
				`[ORG_SWITCH] Calling controller.accountService.switchAccount with organizationId: ${request.organizationId || "undefined"}`,
			)
			const switchStartTime = performance.now()

			await controller.accountService.switchAccount(request.organizationId)

			const switchEndTime = performance.now()
			console.log(
				`[ORG_SWITCH] controller.accountService.switchAccount completed in ${(switchEndTime - switchStartTime).toFixed(2)}ms`,
			)

			const endTime = performance.now()
			console.log(`[ORG_SWITCH] setUserOrganization completed successfully in ${(endTime - startTime).toFixed(2)}ms`)

			return Empty.create({})
		} catch (error) {
			const errorTime = performance.now()
			console.error(`[ORG_SWITCH] setUserOrganization failed after ${(errorTime - startTime).toFixed(2)}ms:`, error)
			throw error
		} finally {
			// Clean up the ongoing request tracking
			ongoingOrganizationSwitches.delete(requestKey)
			console.log(`[ORG_SWITCH_DEDUP] Backend request lock cleared for "${requestKey}"`)
		}
	})()

	// Store the promise to prevent duplicate requests
	ongoingOrganizationSwitches.set(requestKey, requestPromise)
	console.log(`[ORG_SWITCH_DEDUP] Backend request allowed - setting lock for "${requestKey}"`)

	return requestPromise
}
