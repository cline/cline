/**
 * @fileoverview Implementation of the compact logging system's main logger class
 */

import { ILogger, LogMeta, CompactLogEntry, LogLevel } from "./types"
import { CompactTransport } from "./CompactTransport"

/**
 * Main logger implementation providing compact, efficient logging capabilities
 * @implements {ILogger}
 */
export class CompactLogger implements ILogger {
	private transport: CompactTransport
	private parentMeta: LogMeta | undefined

	/**
	 * Creates a new CompactLogger instance
	 * @param transport - Optional custom transport instance
	 * @param parentMeta - Optional parent metadata for hierarchical logging
	 */
	constructor(transport?: CompactTransport, parentMeta?: LogMeta) {
		this.transport = transport ?? new CompactTransport()
		this.parentMeta = parentMeta
	}

	/**
	 * Logs a debug level message
	 * @param message - The message to log
	 * @param meta - Optional metadata to include
	 */
	debug(message: string, meta?: LogMeta): void {
		this.log("debug", message, this.combineMeta(meta))
	}

	/**
	 * Logs an info level message
	 * @param message - The message to log
	 * @param meta - Optional metadata to include
	 */
	info(message: string, meta?: LogMeta): void {
		this.log("info", message, this.combineMeta(meta))
	}

	/**
	 * Logs a warning level message
	 * @param message - The message to log
	 * @param meta - Optional metadata to include
	 */
	warn(message: string, meta?: LogMeta): void {
		this.log("warn", message, this.combineMeta(meta))
	}

	/**
	 * Logs an error level message
	 * @param message - The error message or Error object
	 * @param meta - Optional metadata to include
	 */
	error(message: string | Error, meta?: LogMeta): void {
		this.handleErrorLog("error", message, meta)
	}

	/**
	 * Logs a fatal level message
	 * @param message - The error message or Error object
	 * @param meta - Optional metadata to include
	 */
	fatal(message: string | Error, meta?: LogMeta): void {
		this.handleErrorLog("fatal", message, meta)
	}

	/**
	 * Creates a child logger inheriting this logger's metadata
	 * @param meta - Additional metadata for the child logger
	 * @returns A new logger instance with combined metadata
	 */
	child(meta: LogMeta): ILogger {
		const combinedMeta = this.parentMeta ? { ...this.parentMeta, ...meta } : meta
		return new CompactLogger(this.transport, combinedMeta)
	}

	/**
	 * Closes the logger and its transport
	 */
	close(): void {
		this.transport.close()
	}

	/**
	 * Handles logging of error and fatal messages with special error object processing
	 * @private
	 * @param level - The log level (error or fatal)
	 * @param message - The message or Error object to log
	 * @param meta - Optional metadata to include
	 */
	private handleErrorLog(level: "error" | "fatal", message: string | Error, meta?: LogMeta): void {
		if (message instanceof Error) {
			const errorMeta: LogMeta = {
				...meta,
				ctx: meta?.ctx ?? level,
				error: {
					name: message.name,
					message: message.message,
					stack: message.stack,
				},
			}
			this.log(level, message.message, this.combineMeta(errorMeta))
		} else {
			this.log(level, message, this.combineMeta(meta))
		}
	}

	/**
	 * Combines parent and current metadata with proper context handling
	 * @private
	 * @param meta - The current metadata to combine with parent metadata
	 * @returns Combined metadata or undefined if no metadata exists
	 */
	private combineMeta(meta?: LogMeta): LogMeta | undefined {
		if (!this.parentMeta) {
			return meta
		}
		if (!meta) {
			return this.parentMeta
		}
		return {
			...this.parentMeta,
			...meta,
			ctx: meta.ctx || this.parentMeta.ctx,
		}
	}

	/**
	 * Core logging function that processes and writes log entries
	 * @private
	 * @param level - The log level
	 * @param message - The message to log
	 * @param meta - Optional metadata to include
	 */
	private log(level: LogLevel, message: string, meta?: LogMeta): void {
		const entry: CompactLogEntry = {
			t: Date.now(),
			l: level,
			m: message,
			c: meta?.ctx,
			d: meta ? (({ ctx, ...rest }) => (Object.keys(rest).length > 0 ? rest : undefined))(meta) : undefined,
		}

		this.transport.write(entry)
	}
}
