import { HostProvider } from "@/hosts/host-provider"
import { ErrorService } from "../error"

/**
 * Simple logging utility for the extension's backend code.
 */
export class Logger {
	public readonly channelName = "Cline Dev Logger"
	static error(message: string, error?: Error) {
		Logger.#output("ERROR", message, error)
		ErrorService.get().logMessage(message, "error")
		error && ErrorService.get().logException(error)
	}
	static warn(message: string) {
		Logger.#output("WARN", message)
		ErrorService.get().logMessage(message, "warning")
	}
	static log(message: string, ...optionalParams: any[]) {
		Logger.#output("LOG", message, ...optionalParams)
	}
	static debug(message: string, ...optionalParams: any[]) {
		Logger.#output("DEBUG", message, ...optionalParams)
	}
	static info(message: string, ...optionalParams: any[]) {
		Logger.#output("INFO", message, ...optionalParams)
	}
	static trace(message: string) {
		Logger.#output("TRACE", message)
	}
	static #output(level: string, message: string, error?: Error) {
		let fullMessage = message
		if (error?.message) {
			fullMessage += ` ${error.message}`
		}
		HostProvider.get().logToChannel(`${level} ${fullMessage}`)
		if (error?.stack) {
			console.log(`Stack trace:\n${error.stack}`)
		}
	}
}
