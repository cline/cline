/**
 * Plain text output formatter - no colors, no styling
 * Suitable for piping to other commands or redirecting to files
 */

import type { ClineMessage, OutputFormatter, TaskInfo } from "./types.js"

// Store reference to original stdout.write to bypass console filtering
const stdoutWrite = process.stdout.write.bind(process.stdout)

/**
 * Plain text formatter implementation
 */
export class PlainFormatter implements OutputFormatter {
	message(msg: ClineMessage): void {
		const timestamp = new Date(msg.ts).toISOString()
		const prefix = msg.type === "ask" ? "[?]" : "[>]"
		const subtype = msg.say || msg.ask || ""
		const subtypeStr = subtype ? ` (${subtype})` : ""

		if (msg.text) {
			console.log(`${prefix}${subtypeStr} ${msg.text}`)
		}

		if (msg.reasoning) {
			console.log(`[thinking] ${msg.reasoning}`)
		}
	}

	error(err: Error | string): void {
		const message = err instanceof Error ? err.message : err
		console.error(`ERROR: ${message}`)
	}

	success(text: string): void {
		console.log(`OK: ${text}`)
	}

	warn(text: string): void {
		console.warn(`WARN: ${text}`)
	}

	info(text: string): void {
		console.log(`INFO: ${text}`)
	}

	table(data: Record<string, unknown>[], columns?: string[]): void {
		if (data.length === 0) {
			console.log("(no data)")
			return
		}

		// Determine columns from first row if not specified
		const cols = columns || Object.keys(data[0])

		// Print header
		console.log(cols.join("\t"))

		// Print rows
		for (const row of data) {
			const values = cols.map((col) => String(row[col] ?? ""))
			console.log(values.join("\t"))
		}
	}

	list(items: string[]): void {
		for (const item of items) {
			console.log(`- ${item}`)
		}
	}

	tasks(tasks: TaskInfo[]): void {
		if (tasks.length === 0) {
			console.log("No tasks found")
			return
		}

		for (const task of tasks) {
			const date = new Date(task.ts).toISOString().split("T")[0]
			const status = task.completed ? "[done]" : "[active]"
			const snippet = task.task.length > 50 ? task.task.substring(0, 47) + "..." : task.task
			console.log(`${task.id}\t${date}\t${status}\t${snippet}`)
		}
	}

	keyValue(data: Record<string, unknown>): void {
		for (const [key, value] of Object.entries(data)) {
			console.log(`${key}: ${String(value)}`)
		}
	}

	raw(text: string): void {
		stdoutWrite(text + "\n")
	}

	code(code: string): void {
		stdoutWrite(code + "\n")
	}
}

/**
 * Create a plain text formatter instance
 */
export function createPlainFormatter(): OutputFormatter {
	return new PlainFormatter()
}
