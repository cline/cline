import { Controller } from ".."
import { StringRequest } from "../../../shared/proto/common"

/**
 * Executes a scroll to settings action
 * @param controller The controller instance
 * @param request The request containing the ID of the settings section to scroll to
 * @returns An object with action and value fields for the UI to process
 */
export async function scrollToSettings(controller: Controller, request: StringRequest): Promise<Record<string, string>> {
	return {
		action: "scrollToSettings",
		value: request.value || "",
	}
}
