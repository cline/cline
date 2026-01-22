/**
 * Unified Debug Logger
 *
 * Provides logging utilities for both extension and webview.
 * All logs are written to ~/cline-debug.log for easy access and troubleshooting.
 *
 * Usage:
 *   import { debugLog } from '@/utils/debugLogger'
 *   debugLog('extension', 'info', 'Task started:', taskId)
 */

import * as fs from "fs"
import * as os from "os"
import * as path from "path"

// Single unified log file for both extension and webview
export const DEBUG_LOG_PATH = path.join(os.homedir(), "cline-debug.log")

// Max log file size before rotation (10MB)
const MAX_LOG_SIZE = 10 * 1024 * 1024

/**
 * Log levels
 */
export type LogLevel = "debug" | "info" | "warn" | "error"

/**
 * Log source (extension or webview)
 */
export type LogSource = "extension" | "webview"

/**
 * Format a log entry with timestamp, source, and level
 */
function formatLogEntry(source: LogSource, level: LogLevel, args: unknown[]): string {
	const timestamp = new Date().toISOString()
	const levelUpper = level.toUpperCase().padEnd(5) // Align columns
	const sourceLabel = `[${source.toUpperCase()}]`.padEnd(11) // Align columns

	// Convert args to strings
	const message = args
		.map((arg) => {
			if (arg === undefined) return "undefined"
			if (arg === null) return "null"
			if (typeof arg === "string") return arg
			if (typeof arg === "number" || typeof arg === "boolean") return String(arg)
			if (arg instanceof Error) return `${arg.name}: ${arg.message}\n${arg.stack}`
			try {
				return JSON.stringify(arg, null, 2)
			} catch {
				return String(arg)
			}
		})
		.join(" ")

	return `[${timestamp}] ${sourceLabel} [${levelUpper}] ${message}\n`
}

/**
 * Check if log file needs rotation and rotate if necessary
 */
function rotateLogIfNeeded(): void {
	try {
		if (fs.existsSync(DEBUG_LOG_PATH)) {
			const stats = fs.statSync(DEBUG_LOG_PATH)
			if (stats.size > MAX_LOG_SIZE) {
				const rotatedPath = `${DEBUG_LOG_PATH}.old`
				// Remove old backup if it exists
				if (fs.existsSync(rotatedPath)) {
					fs.unlinkSync(rotatedPath)
				}
				// Rotate current log to backup
				fs.renameSync(DEBUG_LOG_PATH, rotatedPath)
			}
		}
	} catch (error) {
		// Silently fail - don't let logging errors break the app
		console.error("[debugLogger] Failed to rotate log:", error)
	}
}

/**
 * Write a log entry to the debug log file
 *
 * @param source - Where the log is coming from (extension or webview)
 * @param level - Log level (debug, info, warn, error)
 * @param args - Arguments to log (will be stringified)
 */
export function debugLog(source: LogSource, level: LogLevel, ...args: unknown[]): void {
	try {
		// Check if rotation is needed
		rotateLogIfNeeded()

		// Format and append log entry
		const logEntry = formatLogEntry(source, level, args)
		fs.appendFileSync(DEBUG_LOG_PATH, logEntry, "utf8")
	} catch (error) {
		// Silently fail - don't let logging errors break the app
		console.error("[debugLogger] Failed to write log:", error)
	}
}

/**
 * Async version of debugLog for non-blocking logging
 * Recommended for high-frequency logging scenarios
 */
export async function debugLogAsync(source: LogSource, level: LogLevel, ...args: unknown[]): Promise<void> {
	try {
		// Check if rotation is needed
		rotateLogIfNeeded()

		// Format and append log entry
		const logEntry = formatLogEntry(source, level, args)
		await fs.promises.appendFile(DEBUG_LOG_PATH, logEntry, "utf8")
	} catch (error) {
		// Silently fail - don't let logging errors break the app
		console.error("[debugLogger] Failed to write log:", error)
	}
}

/**
 * Convenience wrappers for extension logging
 */
export const extensionLog = {
	debug: (...args: unknown[]) => debugLog("extension", "debug", ...args),
	info: (...args: unknown[]) => debugLog("extension", "info", ...args),
	warn: (...args: unknown[]) => debugLog("extension", "warn", ...args),
	error: (...args: unknown[]) => debugLog("extension", "error", ...args),
}

/**
 * Convenience wrappers for webview logging
 */
export const webviewLog = {
	debug: (...args: unknown[]) => debugLog("webview", "debug", ...args),
	info: (...args: unknown[]) => debugLog("webview", "info", ...args),
	warn: (...args: unknown[]) => debugLog("webview", "warn", ...args),
	error: (...args: unknown[]) => debugLog("webview", "error", ...args),
}

/**
 * Clear the debug log file
 */
export function clearDebugLog(): void {
	try {
		if (fs.existsSync(DEBUG_LOG_PATH)) {
			fs.unlinkSync(DEBUG_LOG_PATH)
		}
	} catch (error) {
		console.error("[debugLogger] Failed to clear log:", error)
	}
}

/**
 * Get the debug log file path
 */
export function getDebugLogPath(): string {
	return DEBUG_LOG_PATH
}
