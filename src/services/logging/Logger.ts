import type { OutputChannel } from "vscode"
import { ErrorService } from "../error/ErrorService"

/**
 * Simple logging utility for the extension's backend code.
 * Uses VS Code's OutputChannel which must be initialized from extension.ts
 * to ensure proper registration with the extension context.
 */
export class Logger {
	private static outputChannel: OutputChannel

	static initialize(outputChannel: OutputChannel) {
		Logger.outputChannel = outputChannel
	}

	static error(message: string, exception?: Error) {
		Logger.outputChannel.appendLine(`ERROR: ${message}`)
		ErrorService.logMessage(message, "error")
		exception && ErrorService.logException(exception)
	}
	static warn(message: string) {
		Logger.outputChannel.appendLine(`WARN: ${message}`)
		ErrorService.logMessage(message, "warning")
	}
	static log(message: string) {
		Logger.outputChannel.appendLine(`LOG: ${message}`)
	}
	static debug(message: string) {
		Logger.outputChannel.appendLine(`DEBUG: ${message}`)
	}
	static info(message: string) {
		Logger.outputChannel.appendLine(`INFO: ${message}`)
	}
	static trace(message: string) {
		Logger.outputChannel.appendLine(`TRACE: ${message}`)
	}
}
