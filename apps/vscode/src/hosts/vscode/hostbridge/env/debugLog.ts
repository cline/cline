import { Empty } from "@shared/proto/cline/common"
import * as vscode from "vscode"
import { DebugLogRequest } from "@/shared/proto/index.host"

const CLINE_OUTPUT_CHANNEL = vscode.window.createOutputChannel("Cline", { log: true })

const LOG_METHOD_BY_LEVEL: Record<string, (message: string) => void> = {
	ERROR: (message) => CLINE_OUTPUT_CHANNEL.error(message),
	WARN: (message) => CLINE_OUTPUT_CHANNEL.warn(message),
	LOG: (message) => CLINE_OUTPUT_CHANNEL.info(message),
	INFO: (message) => CLINE_OUTPUT_CHANNEL.info(message),
	DEBUG: (message) => CLINE_OUTPUT_CHANNEL.debug(message),
	TRACE: (message) => CLINE_OUTPUT_CHANNEL.trace(message),
}

// Appends a log message to all Cline output channels.
export async function debugLog(request: DebugLogRequest): Promise<Empty> {
	const logMethod = LOG_METHOD_BY_LEVEL[request.level ?? "LOG"] ?? LOG_METHOD_BY_LEVEL.LOG
	logMethod(request.value)
	return Empty.create({})
}

// Register the Cline output channel within the VSCode extension context.
export function registerClineOutputChannel(context: vscode.ExtensionContext): vscode.OutputChannel {
	context.subscriptions.push(CLINE_OUTPUT_CHANNEL)
	return CLINE_OUTPUT_CHANNEL
}
