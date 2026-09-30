/**
 * Simple Logger utility for the extension's backend code.
 */
export class Logger {
	// Production bundles replace `process.env.IS_DEV` with "false" at build time.
	// Read lazily so tests can toggle it.
	private static get isVerbose(): boolean {
		return process.env.IS_DEV === "true"
	}

	private static subscribers: Set<(msg: string) => void> = new Set()

	private static output(msg: string): void {
		for (const subscriber of Logger.subscribers) {
			try {
				subscriber(msg)
			} catch {
				// ignore errors from subscribers
			}
		}
	}

	/**
	 * Register a callback to receive log output messages.
	 */
	static subscribe(outputFn: (msg: string) => void) {
		Logger.subscribers.add(outputFn)
	}

	static unsubscribe(outputFn: (msg: string) => void) {
		Logger.subscribers.delete(outputFn)
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
			const formatted = Logger.#formatArgs(args)
			if (formatted) {
				fullMessage += ` ${formatted}`
			}
			const errorSuffix = error?.message ? ` ${error.message}` : ""
			const ts = new Date().toISOString()
			Logger.output(`${ts} ${level} ${fullMessage}${errorSuffix}`.trimEnd())
		} catch {
			// do nothing if Logger fails
		}
	}

	/**
	 * Formats the extra arguments of a log call.
	 *
	 * Verbose (development) builds serialize everything. Production builds are
	 * deliberately narrow because these lines end up in the output channel and
	 * in bug reports that users paste publicly: only error messages (never
	 * stacks, and never other properties of an error), numbers and booleans are
	 * kept. Strings, objects and everything else are dropped, since they routinely
	 * carry URLs with OAuth codes, file or terminal contents, and settings.
	 * Error messages get the same trust as the log message itself: code that
	 * builds an error message must not put secrets in it.
	 */
	static #formatArgs(args: unknown[]): string {
		const parts: string[] = []
		for (const arg of args) {
			const part = Logger.isVerbose ? Logger.#formatVerbose(arg) : Logger.#formatSafe(arg)
			if (part) {
				parts.push(part)
			}
		}
		return parts.join(" ")
	}

	static #formatVerbose(arg: unknown): string | undefined {
		if (arg instanceof Error) {
			return arg.stack || `${arg.name}: ${arg.message}`
		}
		try {
			return JSON.stringify(arg)
		} catch {
			return String(arg)
		}
	}

	static #formatSafe(arg: unknown): string | undefined {
		if (typeof arg === "number" || typeof arg === "boolean") {
			return String(arg)
		}
		if (arg instanceof Error) {
			return Logger.#describeError(arg)
		}
		if (arg && typeof arg === "object") {
			// Error-like objects (e.g. gRPC service errors) and metadata bags of the
			// form `{ ...context, error }`, as SDK loggers pass them.
			const record = arg as { message?: unknown; error?: unknown }
			if (typeof record.message === "string") {
				return record.message
			}
			if (record.error instanceof Error) {
				return Logger.#describeError(record.error)
			}
		}
		return undefined
	}

	static #describeError(error: Error): string {
		const seen = new Set<unknown>()
		const describe = (err: unknown, depth: number): string => {
			if (!(err instanceof Error)) {
				return ""
			}
			seen.add(err)
			let text = `${err.name}: ${err.message}`
			const cause = err.cause
			if (cause instanceof Error && !seen.has(cause) && depth < MAX_CAUSE_DEPTH) {
				text += ` (cause: ${describe(cause, depth + 1)})`
			}
			return text
		}
		return describe(error, 0)
	}
}

const MAX_CAUSE_DEPTH = 3
