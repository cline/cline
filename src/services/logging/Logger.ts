import * as vscode from "vscode"

/**
 * Simple logging utility for the extension's backend code.
 * Uses VS Code's OutputChannel which must be initialized from extension.ts
 * to ensure proper registration with the extension context.
 */
export class Logger {
	private static outputChannel: vscode.OutputChannel

	static initialize(outputChannel: vscode.OutputChannel) {
		Logger.outputChannel = outputChannel
	}

	static log(message: string) {
		if (!Logger.outputChannel) {
			throw new Error("Logger must be initialized first")
		}
		Logger.outputChannel.appendLine(message)
	}
}
