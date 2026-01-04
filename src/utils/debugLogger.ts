/**
 * Unified Debug Logger
 *
 * **IMPORTANT: This is for debugging purposes only.**
 *
 * Provides logging utilities for both extension and webview to help troubleshoot issues.
 * All logs are written to ~/cline-debug.log for easy access during development and debugging.
 *
 * This logger is NOT for production logging - it's specifically designed to help developers
 * diagnose problems during development, testing, or when users report issues.
 *
 * Usage:
 *   import { debugLog, extensionLog } from '@/utils/debugLogger'
 *   extensionLog.info('Task started:', taskId)
 *   debugLog('extension', 'warn', 'Something unexpected happened')
 *
 * Monitoring logs in real-time:
 *   tail -f ~/cline-debug.log
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
 *
 * Use these for debugging extension-side code:
 * - extensionLog.debug() - Verbose debugging info
 * - extensionLog.info() - General informational messages
 * - extensionLog.warn() - Warnings about potential issues
 * - extensionLog.error() - Error conditions
 */
export const extensionLog = {
	debug: (...args: unknown[]) => debugLog("extension", "debug", ...args),
	info: (...args: unknown[]) => debugLog("extension", "info", ...args),
	warn: (...args: unknown[]) => debugLog("extension", "warn", ...args),
	error: (...args: unknown[]) => debugLog("extension", "error", ...args),
}

/**
 * Convenience wrappers for webview logging
 *
 * Use these for debugging webview-side code:
 * - webviewLog.debug() - Verbose debugging info
 * - webviewLog.info() - General informational messages
 * - webviewLog.warn() - Warnings about potential issues
 * - webviewLog.error() - Error conditions
 */
export const webviewLog = {
	debug: (...args: unknown[]) => debugLog("webview", "debug", ...args),
	info: (...args: unknown[]) => debugLog("webview", "info", ...args),
	warn: (...args: unknown[]) => debugLog("webview", "warn", ...args),
	error: (...args: unknown[]) => debugLog("webview", "error", ...args),
}

/**
 * Clear the debug log file
 *
 * Useful when starting a fresh debugging session
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
 *
 * Returns: ~/cline-debug.log
 */
export function getDebugLogPath(): string {
	return DEBUG_LOG_PATH
}
