/**
 * Rich text output formatter - colorful terminal output with styling
 * Uses chalk for ANSI color support
 */

import chalk from "chalk"
import type { ClineMessage, OutputFormatter, TaskInfo } from "./types.js"

// Store reference to original stdout.write to bypass console filtering
const stdoutWrite = process.stdout.write.bind(process.stdout)

/**
 * Rich formatter implementation with colors and styling
 */
export class RichFormatter implements OutputFormatter {
	message(msg: ClineMessage): void {
		const timestamp = chalk.gray(new Date(msg.ts).toLocaleTimeString())

		// Determine icon and color based on message type and subtype
		let icon: string
		let color: typeof chalk

		if (msg.type === "ask") {
			icon = chalk.yellow("?")
			color = chalk.yellow
		} else {
			// Say messages
			switch (msg.say) {
				case "error":
					icon = chalk.red("✗")
					color = chalk.red
					break
				case "completion_result":
					icon = chalk.green("✓")
					color = chalk.green
					break
				case "tool":
					icon = chalk.blue("🔧")
					color = chalk.blue
					break
				case "command":
					icon = chalk.cyan("$")
					color = chalk.cyan
					break
				case "command_output":
					icon = chalk.gray(">")
					color = chalk.gray
					break
				case "api_req_started":
					icon = chalk.magenta("→")
					color = chalk.magenta
					break
				case "api_req_finished":
					icon = chalk.magenta("←")
					color = chalk.magenta
					break
				default:
					icon = chalk.white("●")
					color = chalk.white
			}
		}

		// Output message text
		if (msg.text) {
			const subtypeLabel = msg.say || msg.ask
			const label = subtypeLabel ? chalk.dim(`[${subtypeLabel}]`) : ""
			console.log(`${icon} ${timestamp} ${label}`)
			console.log(`  ${color(msg.text)}`)
		}

		// Output reasoning in a distinct style
		if (msg.reasoning) {
			console.log(chalk.dim.italic(`  💭 ${msg.reasoning}`))
		}

		// Show partial indicator for streaming
		if (msg.partial) {
			console.log(chalk.dim("  ⋯ (streaming)"))
		}
	}

	error(err: Error | string): void {
		const message = err instanceof Error ? err.message : err
		console.error(chalk.red.bold("✗ Error:"), chalk.red(message))
		if (err instanceof Error && err.stack) {
			console.error(chalk.dim(err.stack.split("\n").slice(1).join("\n")))
		}
	}

	success(text: string): void {
		console.log(chalk.green.bold("✓"), chalk.green(text))
	}

	warn(text: string): void {
		console.warn(chalk.yellow.bold("!"), chalk.yellow(text))
	}

	info(text: string): void {
		console.log(chalk.blue.bold("i"), chalk.blue(text))
	}

	table(data: Record<string, unknown>[], columns?: string[]): void {
		if (data.length === 0) {
			console.log(chalk.dim("(no data)"))
			return
		}

		// Determine columns from first row if not specified
		const cols = columns || Object.keys(data[0])

		// Calculate column widths
		const widths = cols.map((col) => {
			const values = data.map((row) => String(row[col] ?? ""))
			return Math.max(col.length, ...values.map((v) => v.length))
		})

		// Print header
		const header = cols.map((col, i) => chalk.bold(col.padEnd(widths[i]))).join("  ")
		console.log(header)
		console.log(chalk.dim("─".repeat(header.length)))

		// Print rows
		for (const row of data) {
			const values = cols.map((col, i) => String(row[col] ?? "").padEnd(widths[i]))
			console.log(values.join("  "))
		}
	}

	list(items: string[]): void {
		for (const item of items) {
			console.log(chalk.cyan("  •"), item)
		}
	}

	tasks(tasks: TaskInfo[]): void {
		if (tasks.length === 0) {
			console.log(chalk.dim("No tasks found"))
			return
		}

		console.log(chalk.bold("Tasks:\n"))

		for (const task of tasks) {
			const date = new Date(task.ts).toLocaleDateString()
			const time = new Date(task.ts).toLocaleTimeString()
			const status = task.completed ? chalk.green("✓ done") : chalk.yellow("◉ active")

			// Truncate task text if too long
			const maxLen = 60
			const snippet = task.task.length > maxLen ? task.task.substring(0, maxLen - 3) + "..." : task.task

			console.log(`  ${chalk.bold(task.id)} ${chalk.dim(`(${date} ${time})`)} ${status}`)
			console.log(`    ${chalk.white(snippet)}`)

			if (task.totalTokens || task.totalCost) {
				const tokens = task.totalTokens ? `${task.totalTokens.toLocaleString()} tokens` : ""
				const cost = task.totalCost ? `$${task.totalCost.toFixed(4)}` : ""
				console.log(`    ${chalk.dim([tokens, cost].filter(Boolean).join(" • "))}`)
			}
			console.log()
		}
	}

	keyValue(data: Record<string, unknown>): void {
		const maxKeyLen = Math.max(...Object.keys(data).map((k) => k.length))

		for (const [key, value] of Object.entries(data)) {
			const paddedKey = key.padEnd(maxKeyLen)
			console.log(`${chalk.bold(paddedKey)}  ${chalk.white(String(value))}`)
		}
	}

	raw(text: string): void {
		// Use stdout.write directly to bypass console filtering
		// This is important for commands like `dump` that output JSON
		// containing strings that would otherwise be filtered
		stdoutWrite(text + "\n")
	}

	code(codeText: string): void {
		console.log(chalk.green(codeText))
	}
}

/**
 * Create a rich text formatter instance
 */
export function createRichFormatter(): OutputFormatter {
	return new RichFormatter()
}
