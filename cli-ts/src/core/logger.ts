import type { Logger } from "../types/logger.js"
import { LogLevel } from "../types/logger.js"

/**
 * Console-based logger with verbose mode support
 */
export class ConsoleLogger implements Logger {
	private verbose: boolean

	constructor(verbose: boolean = false) {
		this.verbose = verbose
	}

	/**
	 * Check if a message at the given level should be logged
	 */
	private shouldLog(level: LogLevel): boolean {
		// TODO - implement log level filtering
		if (level === LogLevel.DEBUG) {
			return this.verbose
		}
		return true
	}

	/**
	 * Format a log message with timestamp and level
	 */
	private formatMessage(level: LogLevel, message: string): string {
		const timestamp = new Date().toISOString()
		const levelUpper = level.toUpperCase().padEnd(5)
		return `[${timestamp}] [${levelUpper}] ${message}`
	}

	debug(message: string, ...args: unknown[]): void {
		if (this.shouldLog(LogLevel.DEBUG)) {
			console.debug(this.formatMessage(LogLevel.DEBUG, message), ...args)
		}
	}

	info(message: string, ...args: unknown[]): void {
		if (this.shouldLog(LogLevel.INFO)) {
			console.info(this.formatMessage(LogLevel.INFO, message), ...args)
		}
	}

	warn(message: string, ...args: unknown[]): void {
		if (this.shouldLog(LogLevel.WARN)) {
			console.warn(this.formatMessage(LogLevel.WARN, message), ...args)
		}
	}

	error(message: string, ...args: unknown[]): void {
		if (this.shouldLog(LogLevel.ERROR)) {
			console.error(this.formatMessage(LogLevel.ERROR, message), ...args)
		}
	}
}

/**
 * Factory function to create a logger instance
 */
export function createLogger(verbose: boolean = false): Logger {
	return new ConsoleLogger(verbose)
}
