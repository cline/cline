/**
 * Simple Logger utility for the extension's backend code.
 */
const REDACTED = "[REDACTED]"
const AWS_ACCESS_KEY = /\b(?:AKIA|ASIA|AIDA|AROA|AIPA|ANPA|ANVA|ASCA)[A-Z0-9]{16}\b/g
const BEARER_TOKEN = /\b(?:bearer|token)\s+[a-z0-9._~+/=-]{12,}\b/gi
const WINDOWS_PATH = /(?:^|[\s"'(])([a-zA-Z]:[\\/](?:[^ \r\n"'<>|*?]+[\\/]?)+)/g
const UNIX_WORKSPACE_PATH = /(?:^|[\s"'(])(\/(?:Users|home|workspace|workspaces|private)\/[^\s"'<>]+)/g

export function sanitizeLogMessage(message: string): string {
	return message
		.replace(AWS_ACCESS_KEY, REDACTED)
		.replace(BEARER_TOKEN, REDACTED)
		.replace(/([?&](?:token|signature|credential|key|secret)=)[^&\s]+/gi, `$1${REDACTED}`)
		.replace(
			/(\b(?:prompt|response|selectedText|terminalContents|toolResult|parameters|command|output)\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s,]+)/gi,
			`$1${REDACTED}`,
		)
		.replace(/(initTask called:)\s*.*$/i, `$1 ${REDACTED}`)
		.replace(WINDOWS_PATH, (match, path: string) => match.replace(path, REDACTED))
		.replace(UNIX_WORKSPACE_PATH, (match, path: string) => match.replace(path, REDACTED))
}

export class Logger {
	private static isVerbose = process.env.IS_DEV === "true"

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
	static subscribe(outputFn: (msg: string) => void): () => void {
		Logger.subscribers.add(outputFn)
		return () => Logger.subscribers.delete(outputFn)
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
			let fullMessage = sanitizeLogMessage(message)
			if (Logger.isVerbose && args.length > 0) {
				// Never serialize arbitrary objects into logs. They routinely carry
				// prompts, tool parameters/results, request bodies, credentials, and
				// workspace paths. Preserve only the argument count for debugging.
				fullMessage += ` [${args.length} redacted argument${args.length === 1 ? "" : "s"}]`
			}
			const errorSuffix = error?.name ? ` ${error.name}` : ""
			const ts = new Date().toISOString()
			Logger.output(`${ts} ${level} ${fullMessage}${errorSuffix}`.trimEnd())
		} catch {
			// do nothing if Logger fails
		}
	}
}
