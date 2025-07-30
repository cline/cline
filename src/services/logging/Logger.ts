import { HostProvider } from "@/hosts/host-provider"
import { ErrorService } from "../error/ErrorService"

/**
 * Simple logging utility for the extension's backend code.
 */
export class Logger {
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
