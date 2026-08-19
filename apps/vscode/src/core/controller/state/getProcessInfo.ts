import { EmptyRequest } from "@shared/proto/cline/common"
import { ProcessInfo } from "@shared/proto/cline/state"
import { Controller } from ".."

/**
 * Gets process information including PID, version, and uptime
 * @param controller The controller instance
 * @param request Empty request
 * @returns ProcessInfo with process details
 */
export async function getProcessInfo(controller: Controller, request: EmptyRequest): Promise<ProcessInfo> {
	// Get the current state to access the version (same source as webview)
	const state = await controller.getStateToPostToWebview()

	return ProcessInfo.create({
		processId: process.pid,
		version: state.version || "unknown",
		uptimeMs: Math.floor(process.uptime() * 1000), // Convert seconds to milliseconds
	})
}
