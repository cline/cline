import * as fs from "fs"
import * as path from "path"
import { HostProvider } from "@/hosts/host-provider"
import { ErrorService } from "../error"
import { getVSCodeLogsDir } from "./constants"
import { cleanupLogsOlderThan, LOG_RETENTION_MS } from "./retention"
import { formatLogFilenameTimestamp, formatLogMessageTimestamp } from "./timestamp"

/**
 * Simple logging utility for the extension's backend code.
 * In VS Code mode, logs to console and a file.
 * In standalone mode, logs to console (which is redirected to file by the parent process).
 */
export class Logger {
	public readonly channelName = "Cline Dev Logger"
	private static fileStream?: fs.WriteStream
	private static logFilePath?: string

	/**
	 * Ensures log file is ready for writing. Creates a new log file if needed.
	 * This method is called automatically on first use.
	 *
	 * Note: If the active log file is deleted during the session, the WriteStream may keep writing to
	 * an unlinked file descriptor (so logs stop persisting to disk).
	 */
	private static ensureLogFileReady(): void {
		// Skip file logging in standalone mode - console is redirected by parent process
		if (process.env.IS_STANDALONE === "true") {
			return
		}

		if (Logger.fileStream) {
			return
		}

		try {
			const logsDir = getVSCodeLogsDir()
			if (!fs.existsSync(logsDir)) {
				fs.mkdirSync(logsDir, { recursive: true })
			}

			const timestamp = formatLogFilenameTimestamp()
			const pid = process.pid
			const logFileName = `cline-vscode-${timestamp}-${pid}.log`

			Logger.logFilePath = path.join(logsDir, logFileName)
			Logger.fileStream = fs.createWriteStream(Logger.logFilePath, { flags: "a" })

			cleanupLogsOlderThan({
				logsDir,
				retentionMs: LOG_RETENTION_MS,
			})

			console.log(`Logger initialized - logs will be written to: ${Logger.logFilePath}`)
		} catch (error) {
			console.error("Failed to initialize file logging:", error)
		}
	}

	/**
	 * Clean up file logging resources.
	 * Should be called in extension deactivate().
	 */
	static cleanup(): void {
		if (Logger.fileStream) {
			Logger.fileStream.end()
			Logger.fileStream = undefined
			Logger.logFilePath = undefined
		}
	}

	/**
	 * Get the path to the current log file (VS Code mode only)
	 */
	static getLogFilePath(): string | undefined {
		return Logger.logFilePath
	}

	/**
	 * Ensures the log file is initialized and returns its path.
	 * This is useful when you need the log file path and want to guarantee it exists.
	 * VS Code mode: Creates the log file if needed and returns the path.
	 * Standalone mode: Returns undefined (logs are managed by parent process).
	 */
	static ensureLogFileAndGetPath(): string | undefined {
		Logger.ensureLogFileReady()
		return Logger.logFilePath
	}

	static error(message: string, error?: Error) {
		Logger.output("ERROR", message, error)
		ErrorService.get().logMessage(message, "error")
		error && ErrorService.get().logException(error)
	}

	static warn(message: string) {
		Logger.output("WARN", message)
		ErrorService.get().logMessage(message, "warning")
	}

	static log(message: string) {
		Logger.output("LOG", message)
	}

	static debug(message: string) {
		Logger.output("DEBUG", message)
	}

	static info(message: string) {
		Logger.output("INFO", message)
	}

	private static output(level: string, message: string, error?: Error) {
		Logger.ensureLogFileReady()

		let fullMessage = message
		if (error?.message) {
			fullMessage += ` ${error.message}`
		}

		// Log to the VS Code output channel
		HostProvider.get().logToChannel(`${level} ${fullMessage}`)
		if (error?.stack) {
			console.log(`Stack trace:\n${error.stack}`)
		}

		// Pass through to standard output naturally - no formatting
		switch (level) {
			case "ERROR":
				if (error) {
					console.error(message, error)
				} else {
					console.error(message)
				}
				break
			case "WARN":
				console.warn(message)
				break
			case "DEBUG":
				console.debug(message)
				break
			case "INFO":
				console.info(message)
				break
			default:
				console.log(message)
				break
		}

		// If VS Code, format and write to file
		if (Logger.fileStream) {
			const timestamp = formatLogMessageTimestamp()
			const formattedMessage = `[${timestamp}] ${level} ${fullMessage}`

			try {
				Logger.fileStream.write(formattedMessage + "\n")
				if (error?.stack) {
					Logger.fileStream.write(`Stack trace:\n${error.stack}\n`)
				}
			} catch (writeError) {
				console.error("Failed to write to log file:", writeError)
			}
		}
	}
}
