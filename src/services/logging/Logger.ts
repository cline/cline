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

	static error(message: string, error?: Error) {
		Logger.#output("ERROR", message, error)
		ErrorService.logMessage(message, "error")
		error && ErrorService.logException(error)
	}
	static warn(message: string) {
		Logger.#output("WARN", message)
		ErrorService.logMessage(message, "warning")
	}
	static log(message: string) {
		Logger.#output("LOG", message)
	}
	static debug(message: string) {
		Logger.#output("DEBUG", message)
	}
	static info(message: string) {
		Logger.#output("INFO", message)
	}
	static trace(message: string) {
		Logger.#output("TRACE", message)
	}
	static #timestamp() {
		const now = new Date()
		const year = now.getFullYear()
		const month = String(now.getMonth() + 1).padStart(2, "0")
		const day = String(now.getDate()).padStart(2, "0")
		const hour = String(now.getHours()).padStart(2, "0")
		const minute = String(now.getMinutes()).padStart(2, "0")
		const second = String(now.getSeconds()).padStart(2, "0")
		const timestamp = `${year}-${month}-${day}T${hour}:${minute}:${second}`
		return timestamp
	}
	static #output(level: string, message: string, error?: Error) {
		let fullMessage = message
		if (error?.message) {
			fullMessage += ` ${error.message}`
		}
		Logger.outputChannel.appendLine(`${level} ${fullMessage}`)
		console.log(`[${Logger.#timestamp()}] ${level} ${fullMessage}`)
		if (error?.stack) {
			console.log(`Stack trace:\n${error.stack}`)
		}
	}
}
