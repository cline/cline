import { Controller } from ".."
import { Int64, Int64Request } from "../../../shared/proto/common"
import { updateGlobalState } from "../../storage/state"

/**
 * Updates the terminal output line limit setting
 * @param controller The controller instance
 * @param request The request containing the line limit value
 * @returns The updated line limit value
 */
export async function updateTerminalOutputLinesLimit(controller: Controller, request: Int64Request): Promise<Int64> {
	try {
		const lineLimit = request.value

		if (typeof lineLimit === "number" && !isNaN(lineLimit) && lineLimit > 0) {
			// Update the global state directly
			await updateGlobalState(controller.context, "terminalOutputLineLimit", lineLimit)
			return Int64.create({ value: lineLimit })
		} else {
			console.warn(`Invalid terminal output line limit value received: ${lineLimit}. Expected a positive number.`)
			throw new Error("Invalid line limit value. Expected a positive number.")
		}
	} catch (error) {
		console.error(`Failed to update terminal output line limit: ${error}`)
		throw error
	}
}
