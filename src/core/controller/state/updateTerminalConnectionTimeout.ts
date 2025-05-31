import { Controller } from ".."
import { Int64, Int64Request } from "../../../shared/proto/common"
import { updateGlobalState } from "../../storage/state"

/**
 * Updates the terminal connection timeout setting
 * @param controller The controller instance
 * @param request The request containing the timeout value in milliseconds
 * @returns The updated timeout value
 */
export async function updateTerminalConnectionTimeout(controller: Controller, request: Int64Request): Promise<Int64> {
	try {
		const timeout = request.value

		if (typeof timeout === "number" && !isNaN(timeout) && timeout > 0) {
			// Update the global state directly
			await updateGlobalState(controller.context, "shellIntegrationTimeout", timeout)
			return Int64.create({ value: timeout })
		} else {
			console.warn(`Invalid shell integration timeout value received: ${timeout}. Expected a positive number.`)
			throw new Error("Invalid timeout value. Expected a positive number.")
		}
	} catch (error) {
		console.error(`Failed to update terminal connection timeout: ${error}`)
		throw error
	}
}
