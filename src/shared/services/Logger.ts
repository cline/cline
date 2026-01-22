/**
 * Simple Logger utility for the extension's backend code.
 */
export class Logger {
	private static isVerbose = process.env.IS_DEV === "true"

	private static output: (msg: string) => void = console.log

	/**
	 * Configure the output function for Logger.
	 * Call this once at extension startup to inject the host-specific logger.
	 */
	static setOutput(outputFn: (msg: string) => void) {
		Logger.output = outputFn
	}

	static error(message: string, ...args: any[]) {
		Logger.#output("ERROR", message, undefined, args)
	}

	static warn(message: string, ...args: any[]) {
		Logger.#output("WARN", message, undefined, args)
	}

	static log(message: string, ...args: any[]) {
		Logger.#output("LOG", message, undefined, args)
	}

	static debug(message: string, ...args: any[]) {
		Logger.#output("DEBUG", message, undefined, args)
	}

	static info(message: string, ...args: any[]) {
		Logger.#output("INFO", message, undefined, args)
	}

	static trace(message: string, ...args: any[]) {
		Logger.#output("TRACE", message, undefined, args)
	}

	static #output(level: string, message: string, error: Error | undefined, args: any[]) {
		try {
			let fullMessage = message
			if (Logger.isVerbose && args.length > 0) {
				fullMessage += ` ${args.map((arg) => JSON.stringify(arg)).join(" ")}`
			}
			const errorSuffix = error?.message ? ` ${error.message}` : ""
			Logger.output(`${level} ${fullMessage}${errorSuffix}`.trimEnd())
		} catch {
			// do nothing if Logger fails
		}
	}
}
