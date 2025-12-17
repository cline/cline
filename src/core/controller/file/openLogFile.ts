import { openFile as openFileIntegration } from "@integrations/misc/open-file"
import { Empty, EmptyRequest } from "@shared/proto/cline/common"
import { Logger } from "@/services/logging/Logger"
import { Controller } from ".."

/**
 * Opens the current log file in the editor.
 * VS Code mode: Opens the log file from global storage.
 * Standalone mode: Does nothing (logs are managed by parent process).
 */
export async function openLogFile(_controller: Controller, _request: EmptyRequest): Promise<Empty> {
	const logPath = Logger.ensureLogFileAndGetPath()
	if (logPath) {
		await openFileIntegration(logPath)
	}
	return Empty.create()
}
