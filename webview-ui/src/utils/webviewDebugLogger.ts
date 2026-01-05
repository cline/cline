/**
 * Webview Debug Logger
 *
 * Intercepts console.log/warn/error/debug calls and sends them to the extension
 * which writes them to ~/cline-debug.log (unified with extension logs)
 *
 * Usage: Import this file early in your app entry point to enable logging.
 * Then use `tail -f ~/cline-debug.log` to watch logs in real-time.
 */

import { PLATFORM_CONFIG } from "../config/platform.config"

// Store original console methods
const originalConsole = {
	log: console.log.bind(console),
	warn: console.warn.bind(console),
	error: console.error.bind(console),
	debug: console.debug.bind(console),
}

// Convert any value to a string for logging
function stringify(arg: unknown): string {
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
}

// Send log to extension
function sendToExtension(level: "log" | "warn" | "error" | "debug", args: unknown[]) {
	try {
		PLATFORM_CONFIG.postMessage({
			type: "webview_debug_log",
			webview_debug_log: {
				level,
				args: args.map(stringify),
				timestamp: Date.now(),
			},
		})
	} catch {
		// Silently fail if postMessage isn't available
	}
}

// Create wrapped console method
function createWrapper(level: "log" | "warn" | "error" | "debug") {
	return (...args: unknown[]) => {
		// Call original console method
		originalConsole[level](...args)
		// Send to extension for file logging
		sendToExtension(level, args)
	}
}

/**
 * Enable webview debug logging.
 * Call this once at app startup to intercept all console calls.
 */
export function enableWebviewDebugLogging() {
	console.log = createWrapper("log")
	console.warn = createWrapper("warn")
	console.error = createWrapper("error")
	console.debug = createWrapper("debug")

	// Log that we've enabled debug logging
	console.log("[WebviewDebugLogger] Debug logging enabled. Logs written to ~/cline-debug.log")
}

/**
 * Disable webview debug logging and restore original console methods.
 */
export function disableWebviewDebugLogging() {
	console.log = originalConsole.log
	console.warn = originalConsole.warn
	console.error = originalConsole.error
	console.debug = originalConsole.debug
}

/**
 * Log directly to file without going through console.
 * Useful for logging in hot paths where you don't want console output.
 */
export function logToFile(level: "log" | "warn" | "error" | "debug", ...args: unknown[]) {
	sendToExtension(level, args)
}
