import { Empty } from "@shared/proto/cline/common"
import { TrackWorktreeViewOpenedRequest } from "@shared/proto/cline/worktree"
import { telemetryService } from "@/services/telemetry"
import { Controller } from ".."

/**
 * Tracks when the worktrees view is opened (for telemetry)
 * @param controller The controller instance
 * @param request The request containing the source of the navigation
 * @returns Empty response
 */
export async function trackWorktreeViewOpened(_controller: Controller, request: TrackWorktreeViewOpenedRequest): Promise<Empty> {
	const source = request.source === "home_page" ? "home_page" : "menu_bar"
	telemetryService.captureWorktreeViewOpened(source)
	return Empty.create({})
}
