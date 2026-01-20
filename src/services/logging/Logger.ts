import { HostProvider } from "@/hosts/host-provider"

/**
 * Simple logging utility for the extension's backend code.
 */
export class Logger {
	public readonly channelName = "Cline Dev Logger"
	static error(message: string, error?: Error) {
		Logger.#output("ERROR", message, error)
	}
	static warn(message: string) {
		Logger.#output("WARN", message)
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
		try {
			let fullMessage = message
			if (error?.message) {
				fullMessage += ` ${error.message}`
			}
			HostProvider.get().logToChannel(`${level} ${fullMessage}`)
		} catch {
			// HostProvider is not ready - skip logging
		}
	}
}
