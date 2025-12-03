import { EmptyRequest, Int64 } from "@shared/proto/cline/common"
import { promises as fsPromises } from "fs"
import * as path from "path"
import { getVSCodeLogsDir } from "@/services/logging/constants"
import { Controller } from ".."

/**
 * Gets the total size of all log files in the VS Code logs folder.
 * Uses async file operations to avoid blocking.
 * @param controller The controller instance
 * @param request Empty request
 * @returns Int64 with the total size in bytes
 */
export async function getLogsSize(_controller: Controller, _request: EmptyRequest): Promise<Int64> {
	const logsDir = getVSCodeLogsDir()

	// Check if directory exists
	try {
		await fsPromises.access(logsDir)
	} catch {
		// Directory doesn't exist, return 0
		return Int64.create({ value: 0 })
	}

	// Directory exists - calculate total size
	let totalSize = 0
	const files = await fsPromises.readdir(logsDir)
	for (const file of files) {
		const filePath = path.join(logsDir, file)
		const stat = await fsPromises.stat(filePath)
		if (stat.isFile()) {
			totalSize += stat.size
		}
	}

	return Int64.create({ value: totalSize })
}
