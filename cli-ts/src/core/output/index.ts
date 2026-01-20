/**
 * Output formatting system - factory and exports
 */

import { createJsonFormatter } from "./json-formatter.js"
import { createPlainFormatter } from "./plain-formatter.js"
import { createRichFormatter } from "./rich-formatter.js"
import type { OutputFormat, OutputFormatter } from "./types.js"

// Re-export formatter classes for direct use if needed
export { JsonFormatter } from "./json-formatter.js"
export { PlainFormatter } from "./plain-formatter.js"
export { RichFormatter } from "./rich-formatter.js"
// Re-export types
export type { ClineMessage, OutputFormat, OutputFormatter, TaskInfo } from "./types.js"

/**
 * Default output format based on TTY detection
 */
export function getDefaultFormat(): OutputFormat {
	// Use rich format if stdout is a TTY, otherwise plain
	return process.stdout.isTTY ? "rich" : "plain"
}

/**
 * Validate that a string is a valid output format
 */
export function isValidFormat(format: string): format is OutputFormat {
	return format === "rich" || format === "json" || format === "plain"
}

/**
 * Parse output format from string, with validation
 */
export function parseOutputFormat(format: string | undefined): OutputFormat {
	if (!format) {
		return getDefaultFormat()
	}

	if (!isValidFormat(format)) {
		throw new Error(`Invalid output format: ${format}. Valid options are: rich, json, plain`)
	}

	return format
}

/**
 * Create an output formatter based on the specified format
 */
export function createFormatter(format: OutputFormat): OutputFormatter {
	switch (format) {
		case "json":
			return createJsonFormatter()
		case "plain":
			return createPlainFormatter()
		case "rich":
			return createRichFormatter()
		default:
			// TypeScript exhaustiveness check
			const _exhaustive: never = format
			throw new Error(`Unknown output format: ${_exhaustive}`)
	}
}

/**
 * Create an output formatter from an optional format string.
 * Uses default format if undefined or invalid.
 */
export function createFormatterFromOption(format: string | undefined): OutputFormatter {
	return createFormatter(parseOutputFormat(format))
}
