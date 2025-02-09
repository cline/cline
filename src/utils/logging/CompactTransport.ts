/**
 * @fileoverview Implementation of the compact logging transport system with file output capabilities
 */

import { writeFileSync, mkdirSync } from "fs"
import { dirname } from "path"
import { CompactTransportConfig, ICompactTransport, CompactLogEntry, LogLevel, LOG_LEVELS } from "./types"

/**
 * Default configuration for the transport
 */
const DEFAULT_CONFIG: CompactTransportConfig = {
	level: "debug",
	fileOutput: {
		enabled: true,
		path: "./logs/app.log",
	},
}

/**
 * Determines if a log entry should be processed based on configured minimum level
 * @param configLevel - The minimum log level from configuration
 * @param entryLevel - The level of the current log entry
 * @returns Whether the entry should be processed
 */
function isLevelEnabled(configLevel: LogLevel, entryLevel: string): boolean {
	const configIdx = LOG_LEVELS.indexOf(configLevel)
	const entryIdx = LOG_LEVELS.indexOf(entryLevel as LogLevel)
	return entryIdx >= configIdx
}

/**
 * Implements the compact logging transport with file output support
 * @implements {ICompactTransport}
 */
export class CompactTransport implements ICompactTransport {
	private sessionStart: number
	private lastTimestamp: number
	private filePath?: string
	private initialized: boolean = false

	/**
	 * Creates a new CompactTransport instance
	 * @param config - Optional transport configuration
	 */
	constructor(readonly config: CompactTransportConfig = DEFAULT_CONFIG) {
		this.sessionStart = Date.now()
		this.lastTimestamp = this.sessionStart

		if (config.fileOutput?.enabled) {
			this.filePath = config.fileOutput.path
		}
	}

	/**
	 * Ensures the log file is initialized with proper directory structure and session start marker
	 * @private
	 * @throws {Error} If file initialization fails
	 */
	private ensureInitialized(): void {
		if (this.initialized || !this.filePath) return

		try {
			mkdirSync(dirname(this.filePath), { recursive: true })
			writeFileSync(this.filePath, "", { flag: "w" })

			const sessionStart = {
				t: 0,
				l: "info",
				m: "Log session started",
				d: { timestamp: new Date(this.sessionStart).toISOString() },
			}
			writeFileSync(this.filePath, JSON.stringify(sessionStart) + "\n", { flag: "w" })

			this.initialized = true
		} catch (err) {
			throw new Error(`Failed to initialize log file: ${(err as Error).message}`)
		}
	}

	/**
	 * Writes a log entry to configured outputs (console and/or file)
	 * @param entry - The log entry to write
	 */
	write(entry: CompactLogEntry): void {
		const deltaT = entry.t - this.lastTimestamp
		this.lastTimestamp = entry.t

		const compact = {
			...entry,
			t: deltaT,
		}

		const output = JSON.stringify(compact) + "\n"

		// Write to console if level is enabled
		if (this.config.level && isLevelEnabled(this.config.level, entry.l)) {
			process.stdout.write(output)
		}

		// Write to file if enabled
		if (this.filePath) {
			this.ensureInitialized()
			writeFileSync(this.filePath, output, { flag: "a" })
		}
	}

	/**
	 * Closes the transport and writes session end marker
	 */
	close(): void {
		if (this.filePath && this.initialized) {
			const sessionEnd = {
				t: Date.now() - this.lastTimestamp,
				l: "info",
				m: "Log session ended",
				d: { timestamp: new Date().toISOString() },
			}
			writeFileSync(this.filePath, JSON.stringify(sessionEnd) + "\n", { flag: "a" })
		}
	}
}
