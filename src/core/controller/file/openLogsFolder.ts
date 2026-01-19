import { Empty, EmptyRequest } from "@shared/proto/cline/common"
import { HostProvider } from "@/hosts/host-provider"
import { getVSCodeLogsDir } from "@/services/logging/constants"
import { Controller } from ".."

/**
 * Opens the centralized logs folder in the OS file manager (Finder, Explorer, etc.)
 * Opens ~/.cline/logs/ so users can see all Cline logs (VS Code, CLI, etc.)
 * @param controller The controller instance
 * @param request Empty request
 * @returns Empty response
 */
export async function openLogsFolder(_controller: Controller, _request: EmptyRequest): Promise<Empty> {
	// Open the centralized logs directory where all Cline logs are stored
	const logsDir = getVSCodeLogsDir()

	await HostProvider.window.revealInFileManager({
		filePath: logsDir,
	})

	return Empty.create()
}
