import { Empty, EmptyRequest } from "@shared/proto/cline/common"
import { promises as fsPromises } from "fs"
import { getVSCodeLogsDir } from "@/services/logging/constants"
import { Controller } from ".."

// TODO (celestial-vault): Clearing logs while Cline is actively running will break logging
// for that session. The Logger's WriteStream will continue writing to the unlinked file
// descriptor, making logs appear to work but not actually persist to disk.
/**
 * Clears all log files from the VS Code logs folder.
 * Uses async file operations to avoid blocking.
 * @param controller The controller instance
 * @param request Empty request
 * @returns Empty response
 */
export async function clearLogs(_controller: Controller, _request: EmptyRequest): Promise<Empty> {
	const logsDir = getVSCodeLogsDir()

	// Check if directory exists
	try {
		await fsPromises.access(logsDir)
	} catch {
		// Directory doesn't exist, nothing to clear
		return Empty.create()
	}

	// Delete the entire directory and recreate it
	await fsPromises.rm(logsDir, { recursive: true, force: true })
	await fsPromises.mkdir(logsDir, { recursive: true })

	return Empty.create()
}
