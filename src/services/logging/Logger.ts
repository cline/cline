import type { OutputChannel } from "vscode"

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

	static log(message: string) {
		Logger.outputChannel.appendLine(message)
	}
}
