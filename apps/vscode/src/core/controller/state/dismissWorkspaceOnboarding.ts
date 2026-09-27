import { Empty, type EmptyRequest } from "@shared/proto/cline/common"
import { Logger } from "@/shared/services/Logger"
import type { Controller } from "../index"

/**
 * Silences the RFC 0001 workspace onboarding card for the active workspace
 * folder. The dismissal is recorded per folder path, so opening a different
 * uninitialized project still offers to initialize it.
 * @param controller The controller instance
 * @param _request Unused empty request
 * @returns Empty response
 */
export async function dismissWorkspaceOnboarding(controller: Controller, _request: EmptyRequest): Promise<Empty> {
	try {
		await controller.dismissWorkspaceOnboarding()
	} catch (error) {
		Logger.error("Error in dismissWorkspaceOnboarding:", error)
		throw error
	}
	return Empty.create()
}
