import { Empty, type EmptyRequest } from "@shared/proto/cline/common"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from "../index"

/**
 * Scaffolds a `.cline/` workspace in the active workspace folder (RFC 0001 §3.2
 * onboarding card). Rule discovery, the status bar, and history scoping pick the
 * new workspace up from the state this posts back, so no reload is needed.
 * @param controller The controller instance
 * @param _request Unused empty request
 * @returns Empty response
 */
export async function initializeWorkspace(controller: Controller, _request: EmptyRequest): Promise<Empty> {
	try {
		await controller.initializeWorkspace()
	} catch (error) {
		Logger.error("Error in initializeWorkspace:", error)
		throw error
	}
	return Empty.create()
}
