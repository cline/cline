/**
 * JSON output formatter - structured output for scripting/automation
 * Each output is a single JSON line for easy parsing
 */

import type { ClineMessage, OutputFormatter, TaskInfo } from "./types.js"

/**
 * JSON output wrapper type
 */
interface JsonOutput {
	type: "message" | "error" | "success" | "warn" | "info" | "table" | "list" | "tasks" | "keyValue" | "raw" | "code"
	data: unknown
	ts: number
}

/**
 * JSON formatter implementation
 */
export class JsonFormatter implements OutputFormatter {
	/**
	 * Output a JSON line to stdout
	 */
	private output(type: JsonOutput["type"], data: unknown): void {
		const output: JsonOutput = {
			type,
			data,
			ts: Date.now(),
		}
		console.log(JSON.stringify(output))
	}

	message(msg: ClineMessage): void {
		this.output("message", msg)
	}

	error(err: Error | string): void {
		const data = err instanceof Error ? { message: err.message, name: err.name, stack: err.stack } : { message: err }
		this.output("error", data)
	}

	success(text: string): void {
		this.output("success", { message: text })
	}

	warn(text: string): void {
		this.output("warn", { message: text })
	}

	info(text: string): void {
		this.output("info", { message: text })
	}

	table(data: Record<string, unknown>[], columns?: string[]): void {
		this.output("table", { rows: data, columns: columns || (data.length > 0 ? Object.keys(data[0]) : []) })
	}

	list(items: string[]): void {
		this.output("list", { items })
	}

	tasks(tasks: TaskInfo[]): void {
		this.output("tasks", { tasks })
	}

	keyValue(data: Record<string, unknown>): void {
		this.output("keyValue", data)
	}

	raw(text: string): void {
		this.output("raw", { content: text })
	}

	code(code: any): void {
		this.output("code", { code })
	}
}

/**
 * Create a JSON formatter instance
 */
export function createJsonFormatter(): OutputFormatter {
	return new JsonFormatter()
}
